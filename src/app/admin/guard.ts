/**
 * A small guard used by every platform-admin page.
 *
 * Pages are the first thing a visitor reaches, so each admin page starts by calling this. It:
 *   - sends visitors who are not signed in to the sign-in page (and brings them back afterwards);
 *   - answers "404 not found" to anyone signed in who is NOT a platform admin. We use 404 rather
 *     than "forbidden" so the admin screens do not even reveal that they exist.
 * It returns the signed-in platform admin so the page can pass them on to the use cases.
 *
 * This is only the page-level door. The use cases and database queries check permission AGAIN,
 * so even a request that skipped the page cannot change anything.
 */
import { notFound, redirect } from "next/navigation";
import { canManageAgencies } from "@/domain/permissions";
import { getActor } from "@/server/auth/guards";
import type { AuthenticatedActor } from "@/server/auth/session-user";

/** `returnTo` is the page's own address, so sign-in can send the visitor back to it. */
export async function requirePlatformAdminPage(returnTo: string): Promise<AuthenticatedActor> {
  const actor = await getActor();
  if (!actor) redirect(`/sign-in?next=${encodeURIComponent(returnTo)}`);
  if (!canManageAgencies(actor)) notFound();
  return actor;
}
