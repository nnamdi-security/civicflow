/**
 * Staff management: inviting people and deactivating or reactivating their accounts (ADR 0014).
 *
 * "Staff" means anyone who is not an ordinary resident: agency officers, agency admins and
 * platform admins.
 *
 *   - INVITING pre-creates the account. The person then signs in with a link sent to that email
 *     address (ADR 0005); there are no passwords to share.
 *   - DEACTIVATING switches an account off without deleting anything. The person can no longer
 *     sign in, any open session ends on their next request, and they receive no notifications.
 *     Everything they did stays in the history. REACTIVATING switches it back on.
 *
 * Who may do what is decided by the pure rules in src/domain/permissions.ts
 * (`canProvisionUser`, `canDeactivateUser`). Like every change, each action here is written to
 * the audit log in the same transaction, and the audit sentence never contains an email address.
 */
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { agencies, sessions, users } from "../../db/schema";
import { canDeactivateUser, canManageStaff, canProvisionUser } from "../../domain/permissions";
import { ROLES, type Role } from "../../domain/roles";
import { normalizeEmail } from "../auth/config";
import { ForbiddenError, UnauthenticatedError } from "../auth/errors";
import type { AuthenticatedActor } from "../auth/session-user";
import { recordAudit } from "../repositories/audit";
import { AgencyNotFoundError, UserExistsError, provisionUser } from "../users/provisioning";
import type { AdminDeps } from "./agencies";

// ---- Inviting ------------------------------------------------------------------------------

export type InviteStaffResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "malformed" | "email_invalid" | "already_exists" | "agency_not_found" };

const inviteSchema = z.object({
  email: z.string().max(254),
  role: z.enum(ROLES),
  agencyId: z.uuid().nullable(),
});

/**
 * Creates a staff account that can then sign in by email.
 * An agency admin can only invite OFFICERS into their OWN agency; a platform admin can invite any
 * staff role into any agency (platform admins themselves have no agency).
 */
export async function inviteStaff(
  deps: AdminDeps,
  actorOrNull: AuthenticatedActor | null,
  raw: unknown,
): Promise<InviteStaffResult> {
  if (!actorOrNull) throw new UnauthenticatedError();
  if (!canManageStaff(actorOrNull)) throw new ForbiddenError();
  const actor = actorOrNull;

  const parsed = inviteSchema.safeParse(raw);
  if (!parsed.success) {
    // A bad email address is the one mistake a person is likely to make; give it its own message.
    const emailBad = parsed.error.issues.some((issue) => issue.path[0] === "email");
    return { ok: false, reason: emailBad ? "email_invalid" : "malformed" };
  }
  const input = parsed.data;

  let email: string;
  try {
    email = normalizeEmail(input.email);
  } catch {
    return { ok: false, reason: "email_invalid" };
  }

  // The same permission rule used elsewhere decides whether this role/agency combination is allowed.
  // It also protects against inviting a resident or an inconsistent role/agency pair.
  if (!canProvisionUser(actor, { role: input.role, agencyId: input.agencyId })) throw new ForbiddenError();

  try {
    const userId = await deps.db.transaction(async (tx) => {
      const created = await provisionUser(tx, actor, { email, role: input.role, agencyId: input.agencyId });

      // Describe the new account in the audit log WITHOUT the email address.
      let agencyLabel = "no agency";
      if (input.agencyId) {
        const [agency] = await tx.select({ name: agencies.name }).from(agencies).where(eq(agencies.id, input.agencyId)).limit(1);
        agencyLabel = `"${agency?.name ?? "unknown agency"}"`;
      }
      await recordAudit(tx, {
        actor,
        action: "staff.invited",
        targetType: "user",
        targetId: created.id,
        summary: `invited a new ${input.role} (${agencyLabel})`,
      });
      return created.id;
    });
    return { ok: true, userId };
  } catch (error) {
    if (error instanceof UserExistsError) return { ok: false, reason: "already_exists" };
    if (error instanceof AgencyNotFoundError) return { ok: false, reason: "agency_not_found" };
    throw error;
  }
}

// ---- Deactivating and reactivating ---------------------------------------------------------

export type SetStaffActiveResult =
  | { ok: true; changed: boolean }
  | { ok: false; reason: "malformed" | "not_found" | "last_platform_admin" };

const activeSchema = z.object({ userId: z.uuid(), active: z.boolean() });

/**
 * Switches a staff account off (`active: false`) or back on (`active: true`).
 *
 * To an agency admin, accounts they are not allowed to manage look exactly like accounts that do
 * not exist ("not_found"), so they cannot use this to find out who works elsewhere.
 */
export async function setStaffActive(
  deps: AdminDeps,
  actorOrNull: AuthenticatedActor | null,
  raw: unknown,
): Promise<SetStaffActiveResult> {
  if (!actorOrNull) throw new UnauthenticatedError();
  if (!canManageStaff(actorOrNull)) throw new ForbiddenError();
  const actor = actorOrNull;

  const parsed = activeSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "malformed" };
  const { userId, active } = parsed.data;

  const [target] = await deps.db
    .select({
      id: users.id,
      role: users.role,
      agencyId: users.agencyId,
      disabledAt: users.disabledAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  // Unknown account, OR an account this person may not manage: same answer either way.
  if (!target || !canDeactivateUser(actor, actor.userId, { userId: target.id, role: target.role, agencyId: target.agencyId })) {
    return { ok: false, reason: "not_found" };
  }

  const alreadyInState = (target.disabledAt === null) === active;
  if (alreadyInState) return { ok: true, changed: false };

  const roleLabel: Role = target.role;
  const outcome = await deps.db.transaction(async (tx): Promise<"done" | "last_platform_admin"> => {
    // Safety rule: there must always be at least one ACTIVE platform admin, or nobody could fix
    // things. This check is INSIDE the transaction and LOCKS the active platform-admin rows
    // (`for update`). Why that matters: if two admins deactivate EACH OTHER at the same moment,
    // both would otherwise count "two admins, fine" and both succeed, leaving none. With the
    // lock, the second one waits for the first to finish, then counts again and is refused.
    if (!active && target.role === "platform_admin") {
      const activeAdmins = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.role, "platform_admin"), isNull(users.disabledAt)))
        .for("update");
      // This list includes the target (still active), so one entry means they are the only one.
      if (activeAdmins.length <= 1) return "last_platform_admin";
    }

    await tx
      .update(users)
      .set({ disabledAt: active ? null : new Date() })
      .where(eq(users.id, userId));
    // Deactivating also deletes their open sessions, so the sign-in cookies stop working at once.
    if (!active) await tx.delete(sessions).where(eq(sessions.userId, userId));
    await recordAudit(tx, {
      actor,
      action: active ? "staff.reactivated" : "staff.deactivated",
      targetType: "user",
      targetId: userId,
      summary: `${active ? "reactivated" : "deactivated"} an account (${roleLabel})`,
    });
    return "done";
  });
  if (outcome === "last_platform_admin") return { ok: false, reason: "last_platform_admin" };
  return { ok: true, changed: true };
}
