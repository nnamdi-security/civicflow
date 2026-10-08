import { z } from "zod";
import type { Actor } from "../../domain/permissions";
import { ROLES, type Role } from "../../domain/roles";

const sessionUserSchema = z.object({
  id: z.string().min(1),
  role: z.enum(ROLES),
  agencyId: z.string().min(1).nullish(),
});

export interface SessionUser {
  id: string;
  role: Role;
  agencyId: string | null;
}

export interface AuthenticatedActor extends Actor {
  userId: string;
}

/**
 * Narrows the database user row to what the session exposes. Fails closed: an unknown role
 * throws rather than defaulting to anything.
 */
export function toSessionUser(row: unknown): SessionUser {
  const parsed = sessionUserSchema.parse(row);
  return { id: parsed.id, role: parsed.role, agencyId: parsed.agencyId ?? null };
}

/** Builds the actor from a session-shaped value, or null when nobody is signed in. */
export function actorFromSession(
  session: { user?: { id: string; role: Role; agencyId: string | null } } | null,
): AuthenticatedActor | null {
  if (!session?.user) return null;
  const { id, role, agencyId } = session.user;
  return { userId: id, role, agencyId };
}
