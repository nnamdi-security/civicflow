import { redirect } from "next/navigation";
import { Button } from "@/components/button";
import { auth } from "@/server/auth";
import { getActor } from "@/server/auth/guards";
import { getDb } from "@/server/db";
import { findAgencyName } from "@/server/repositories/agencies";
import { signOutAction } from "./actions";

const ROLE_LABELS = {
  resident: "Resident",
  agency_officer: "Agency officer",
  agency_admin: "Agency admin",
  platform_admin: "Platform admin",
} as const;

export default async function AccountPage() {
  const actor = await getActor();
  if (!actor) redirect("/sign-in");

  const session = await auth();
  const agencyName = actor.agencyId ? await findAgencyName(getDb(), actor.agencyId) : null;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Your account</h1>
      <dl className="flex flex-col gap-2">
        <div>
          <dt className="font-medium">Email</dt>
          <dd>{session?.user.email}</dd>
        </div>
        <div>
          <dt className="font-medium">Role</dt>
          <dd>{ROLE_LABELS[actor.role]}</dd>
        </div>
        {agencyName ? (
          <div>
            <dt className="font-medium">Agency</dt>
            <dd>{agencyName}</dd>
          </div>
        ) : null}
      </dl>
      <form action={signOutAction}>
        <Button type="submit">Sign out</Button>
      </form>
    </main>
  );
}
