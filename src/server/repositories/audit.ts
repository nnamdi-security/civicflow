/**
 * Reading and writing the audit log (ADR 0014).
 *
 * The audit log is the permanent record of who changed which administrative setting. Writing an
 * entry is always done INSIDE the same database transaction as the change itself, so the change
 * and its record are saved together or not at all.
 */
import { desc, eq } from "drizzle-orm";
import type { Db, Tx } from "../../db/client";
import { auditLog, users } from "../../db/schema";
import type { AuditAction } from "../../domain/admin";
import type { Role } from "../../domain/roles";

export interface AuditEntryInput {
  /** The admin making the change. We keep their id and the role they held at that moment. */
  actor: { userId: string; role: Role };
  action: AuditAction;
  /** What kind of record changed, for example "agency". */
  targetType: string;
  /** Which record changed, when there is one. */
  targetId: string | null;
  /** One plain sentence about the change. MUST NOT contain emails, phone numbers or other personal data. */
  summary: string;
}

/** Adds one line to the audit log. Pass the open transaction (`tx`) of the change being recorded. */
export async function recordAudit(tx: Tx, entry: AuditEntryInput): Promise<void> {
  await tx.insert(auditLog).values({
    actorId: entry.actor.userId,
    actorRole: entry.actor.role,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    summary: entry.summary,
  });
}

export interface AuditRow {
  id: string;
  createdAt: Date;
  action: AuditAction;
  actorRole: string;
  /** Shown only on the platform-admin audit page, so admins can see who did what. */
  actorEmail: string;
  summary: string;
}

/** The newest audit entries first. Only platform admins may call this (checked by the caller). */
export async function listRecentAudit(db: Db, limit = 100): Promise<AuditRow[]> {
  return db
    .select({
      id: auditLog.id,
      createdAt: auditLog.createdAt,
      action: auditLog.action,
      actorRole: auditLog.actorRole,
      actorEmail: users.email,
      summary: auditLog.summary,
    })
    .from(auditLog)
    .innerJoin(users, eq(users.id, auditLog.actorId))
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(limit);
}
