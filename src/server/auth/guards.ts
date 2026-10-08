import type { Role } from "../../domain/roles";
import { ForbiddenError, UnauthenticatedError } from "./errors";
import { auth } from "./index";
import { actorFromSession, type AuthenticatedActor } from "./session-user";

export { ForbiddenError, UnauthenticatedError } from "./errors";
export type { AuthenticatedActor } from "./session-user";

export async function getActor(): Promise<AuthenticatedActor | null> {
  return actorFromSession(await auth());
}

/** First line of every mutation: who is calling. Throws if nobody is signed in. */
export async function requireActor(): Promise<AuthenticatedActor> {
  const actor = await getActor();
  if (!actor) throw new UnauthenticatedError();
  return actor;
}

/** Authenticates and requires one of the given roles. */
export async function requireRole(...roles: Role[]): Promise<AuthenticatedActor> {
  const actor = await requireActor();
  if (!roles.includes(actor.role)) throw new ForbiddenError();
  return actor;
}
