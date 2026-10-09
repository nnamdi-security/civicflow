import { eq } from "drizzle-orm";
import type { Db, Tx } from "../../db/client";
import { agencies, users } from "../../db/schema";
import { canProvisionUser, type Actor } from "../../domain/permissions";
import type { Role } from "../../domain/roles";
import { normalizeEmail } from "../auth/config";
import { ForbiddenError } from "../auth/errors";

export class UserExistsError extends Error {
  constructor() {
    super("A user with that email already exists");
    this.name = "UserExistsError";
  }
}

export class AgencyNotFoundError extends Error {
  constructor() {
    super("Agency not found");
    this.name = "AgencyNotFoundError";
  }
}

export interface ProvisionInput {
  email: string;
  role: Role;
  agencyId: string | null;
}

/**
 * Pre-creates a staff account. The person then signs in by magic link to that email (ADR 0005).
 * Authorization is checked first. Existing accounts are never modified here: changing a role
 * is a separate, deliberate action.
 */
export async function provisionUser(db: Db | Tx, actor: Actor, input: ProvisionInput) {
  if (!canProvisionUser(actor, { role: input.role, agencyId: input.agencyId })) {
    throw new ForbiddenError();
  }
  const email = normalizeEmail(input.email);

  if (input.agencyId !== null) {
    const [agency] = await db
      .select({ id: agencies.id })
      .from(agencies)
      .where(eq(agencies.id, input.agencyId))
      .limit(1);
    if (!agency) throw new AgencyNotFoundError();
  }

  const [created] = await db
    .insert(users)
    .values({ email, role: input.role, agencyId: input.agencyId })
    .onConflictDoNothing({ target: users.email })
    .returning({ id: users.id });
  if (!created) throw new UserExistsError();
  return created;
}

/**
 * Bootstrap for the first platform admin, run by a trusted operator from the command line
 * (`pnpm admin:create`). Creates the account or promotes an existing one.
 */
export async function ensurePlatformAdmin(db: Db, rawEmail: string) {
  const email = normalizeEmail(rawEmail);
  const [row] = await db
    .insert(users)
    .values({ email, role: "platform_admin", agencyId: null })
    .onConflictDoUpdate({
      target: users.email,
      set: { role: "platform_admin", agencyId: null },
    })
    .returning({ id: users.id });
  if (!row) throw new Error("Could not create platform admin");
  return row;
}
