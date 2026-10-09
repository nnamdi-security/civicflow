import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/button";
import { agencyScopeFor, canEraseAccount } from "@/domain/permissions";
import { auth } from "@/server/auth";
import { getActor } from "@/server/auth/guards";
import { getDb } from "@/server/db";
import { findAgencyName } from "@/server/repositories/agencies";
import { getSmsSender } from "@/server/account/deps";
import { findNotificationSettings } from "@/server/repositories/account";
import { confirmPhoneAction, eraseAccountAction, removePhoneAction, savePreferencesAction, signOutAction, startPhoneAction } from "./actions";
import { noticeFor } from "./messages";

const ROLE_LABELS = {
  resident: "Resident",
  agency_officer: "Agency officer",
  agency_admin: "Agency admin",
  platform_admin: "Platform admin",
} as const;

const fieldClass = "min-h-11 rounded-md border border-current bg-transparent px-3 py-2";
const timeFormat = new Intl.DateTimeFormat("en-NG", { timeStyle: "short", timeZone: "Africa/Lagos" });

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams;
  const actor = await getActor();
  if (!actor) redirect("/sign-in");

  const session = await auth();
  const agencyName = actor.agencyId ? await findAgencyName(getDb(), actor.agencyId) : null;
  const settings = await findNotificationSettings(getDb(), actor.userId);
  const smsAvailable = getSmsSender() !== null;
  const message = noticeFor(notice);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-6">
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
      {message ? (
        <p role={message.ok ? "status" : "alert"} className="rounded-md border border-current p-3">
          {message.ok ? "" : "Error: "}
          {message.text}
        </p>
      ) : null}

      {settings ? (
        <section aria-labelledby="notifications-heading" className="flex flex-col gap-4">
          <h2 id="notifications-heading" className="text-lg font-semibold">
            Notifications
          </h2>

          <form action={savePreferencesAction} className="flex flex-col gap-3">
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" name="notifyEmail" defaultChecked={settings.notifyEmail} className="size-5" />
              <span>Email me updates about my reports</span>
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                name="notifySms"
                defaultChecked={settings.notifySms}
                disabled={!settings.phoneVerified || !smsAvailable}
                className="size-5"
              />
              <span>
                Text me when a report is resolved or badly overdue
                {!settings.phoneVerified ? " (confirm a phone number first)" : ""}
              </span>
            </label>
            <Button type="submit" className="self-start">
              Save settings
            </Button>
          </form>

          <div className="flex flex-col gap-3">
            <h3 className="font-medium">Phone number</h3>
            {!smsAvailable ? <p>SMS updates are not available right now.</p> : null}
            {settings.phoneVerified && settings.maskedPhone ? (
              <form action={removePhoneAction} className="flex flex-wrap items-center gap-3">
                <span>Confirmed: {settings.maskedPhone}</span>
                <Button type="submit">Remove number</Button>
              </form>
            ) : null}

            {settings.pending ? (
              <form action={confirmPhoneAction} className="flex flex-col gap-2">
                <label className="flex flex-col gap-1">
                  <span className="font-medium">
                    Code sent to {settings.pending.maskedPhone} (valid until {timeFormat.format(settings.pending.expiresAt)})
                  </span>
                  <input
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9 ]{6,7}"
                    maxLength={7}
                    required
                    className={fieldClass}
                  />
                </label>
                <Button type="submit" className="self-start">
                  Confirm number
                </Button>
              </form>
            ) : null}

            {smsAvailable ? (
              <form action={startPhoneAction} className="flex flex-col gap-2">
                <label className="flex flex-col gap-1">
                  <span className="font-medium">
                    {settings.phoneVerified ? "Use a different number" : "Add a mobile number"}
                  </span>
                  <input
                    name="phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="0803 123 4567"
                    maxLength={40}
                    required
                    className={fieldClass}
                  />
                </label>
                <Button type="submit" className="self-start">
                  Send code
                </Button>
              </form>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Download a copy of your data. Available to everyone who is signed in. */}
      <section aria-labelledby="data-heading" className="flex flex-col gap-2">
        <h2 id="data-heading" className="text-lg font-semibold">Your data</h2>
        <p>You can download a copy of the personal information we hold about you, as a file.</p>
        <a
          href="/account/export"
          className="underline focus-visible:outline-2 focus-visible:outline-offset-2"
          download
        >
          Download my data
        </a>
      </section>

      {/* Deleting an account is for residents only; staff are deactivated by an administrator instead. */}
      {canEraseAccount(actor) ? (
        <section aria-labelledby="delete-heading" className="flex flex-col gap-2">
          <h2 id="delete-heading" className="text-lg font-semibold">Delete my account</h2>
          <details className="rounded-md border border-current p-3">
            <summary className="cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-offset-2">
              I want to permanently delete my account
            </summary>
            <div className="mt-3 flex flex-col gap-3">
              <p>This cannot be undone. When you delete your account:</p>
              <ul className="list-disc pl-6">
                <li>your email address, name and phone number are removed, and you are signed out everywhere;</li>
                <li>the descriptions and photos of your reports are deleted, and their exact locations are blurred;</li>
                <li>any notes you wrote in a report&rsquo;s history are removed.</li>
              </ul>
              <p>
                Your reports stay on record without any personal details (what kind of problem, which agency, which area,
                and what happened and when), so the public history of what agencies did is kept. The agency can no
                longer contact you about them.
              </p>
              <form action={eraseAccountAction} className="flex flex-col gap-2">
                <label className="flex flex-col gap-1">
                  <span className="font-medium">Type DELETE to confirm</span>
                  <input name="confirmation" autoComplete="off" required className={fieldClass} />
                </label>
                <Button type="submit" className="self-start">Delete my account permanently</Button>
              </form>
            </div>
          </details>
        </section>
      ) : null}

      {agencyScopeFor(actor).kind !== "none" ? (
        <Link href="/agency" className="underline focus-visible:outline-2 focus-visible:outline-offset-2">
          Reports inbox
        </Link>
      ) : null}
      <form action={signOutAction}>
        <Button type="submit">Sign out</Button>
      </form>
    </main>
  );
}
