/**
 * Staff management: /agency/staff
 *
 *   - An AGENCY ADMIN sees the people in their own agency, can invite officers, and can deactivate
 *     or reactivate officers.
 *   - A PLATFORM ADMIN sees every staff account, can invite anyone into any agency, and can
 *     deactivate or reactivate any staff account except their own.
 *   - Everyone else gets "not found".
 *
 * The buttons shown here use the SAME permission rule as the server (`canDeactivateUser`), so the
 * page never offers an action that would be refused. The server still checks again when the
 * button is pressed; the page is a convenience, not the lock.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button } from "@/components/button";
import { Notice } from "@/components/notice";
import { agencyScopeFor, canDeactivateUser, canManageStaff } from "@/domain/permissions";
import { getActor } from "@/server/auth/guards";
import { getDb } from "@/server/db";
import { listAgencies, listStaff } from "@/server/repositories/admin";
import { inviteStaffAction, setStaffActiveAction } from "./actions";
import { noticeFor } from "./messages";

export const metadata: Metadata = { title: "Staff", robots: { index: false, follow: false } };

const fieldClass = "min-h-11 rounded-md border border-current bg-transparent px-3 py-2";

export default async function StaffPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams;

  // Who is asking? Visitors who are not signed in go to sign-in; people without the right role get "not found".
  const actor = await getActor();
  if (!actor) redirect("/sign-in?next=%2Fagency%2Fstaff");
  if (!canManageStaff(actor)) notFound();

  const db = getDb();
  const isPlatformAdmin = actor.role === "platform_admin";
  // `agencyScopeFor` is the same rule the query uses: an agency admin only ever receives their own agency's people.
  const staff = await listStaff(db, agencyScopeFor(actor));
  // The agency menu is only needed by platform admins (agency admins always invite into their own agency).
  const agencies = isPlatformAdmin ? await listAgencies(db) : [];

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-6">
      <Link href="/agency" className="underline focus-visible:outline-2 focus-visible:outline-offset-2">Back to reports</Link>
      <h1 className="text-2xl font-semibold">{isPlatformAdmin ? "Staff" : "Your agency's staff"}</h1>
      <Notice notice={noticeFor(notice)} />

      {staff.length === 0 ? (
        <p>There are no staff accounts to show.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {staff.map((person) => {
            // May THIS signed-in person deactivate/reactivate THAT person? (Same rule the server applies.)
            const mayManage = canDeactivateUser(actor, actor.userId, {
              userId: person.id,
              role: person.role,
              agencyId: person.agencyId,
            });
            return (
              <li key={person.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-current p-3">
                <span>
                  <span className="font-medium">{person.email}</span>
                  <span className="block text-sm">
                    {person.role}
                    {person.agencyName ? ` · ${person.agencyName}` : ""} · {person.deactivated ? "Deactivated" : "Active"}
                    {person.id === actor.userId ? " · This is you" : ""}
                  </span>
                </span>
                {mayManage ? (
                  <form action={setStaffActiveAction}>
                    <input type="hidden" name="userId" value={person.id} />
                    {/* The button's value says which state to switch TO. */}
                    <Button type="submit" name="state" value={person.deactivated ? "on" : "off"}>
                      {person.deactivated ? `Reactivate ${person.email}` : `Deactivate ${person.email}`}
                    </Button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <form action={inviteStaffAction} className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{isPlatformAdmin ? "Invite a staff member" : "Invite an officer"}</h2>
        <p className="text-sm">
          This creates the account. The person then signs in with a link sent to this email address; there are no
          passwords.
        </p>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Email address</span>
          <input name="email" type="email" required maxLength={254} autoComplete="off" className={fieldClass} />
        </label>

        {isPlatformAdmin ? (
          <>
            <label className="flex flex-col gap-1">
              <span className="font-medium">Role</span>
              <select name="role" required defaultValue="agency_officer" className={fieldClass}>
                <option value="agency_officer">Agency officer</option>
                <option value="agency_admin">Agency admin</option>
                <option value="platform_admin">Platform admin</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-medium">Agency (leave empty for a platform admin)</span>
              <select name="agencyId" defaultValue="" className={fieldClass}>
                <option value="">No agency</option>
                {agencies.map((agency) => (
                  <option key={agency.id} value={agency.id}>{agency.name}</option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <p className="text-sm">They will be an officer in your agency.</p>
        )}
        <Button type="submit" className="self-start">Invite</Button>
      </form>
    </main>
  );
}
