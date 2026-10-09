/**
 * System health: /admin/health. Platform admins only.
 *
 * Shows whether the background worker is running and whether messages or photo deletions are
 * piling up. Every number here is a count or a time; there is no personal data on this page.
 *
 * How to read it: each background job should "report in" regularly. If one is LATE, FAILING or
 * NEVER RUN, deadlines may not be enforced or messages may not be sent. The runbook
 * (docs/runbook.md) says what to do.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { systemClock } from "@/domain/clock";
import type { JobHealth } from "@/domain/operations";
import { getDb } from "@/server/db";
import { getSystemHealth } from "@/server/operations/health";
import { requirePlatformAdminPage } from "../guard";

export const metadata: Metadata = { title: "System health", robots: { index: false, follow: false } };

const dateTimeFormat = new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "medium", timeZone: "Africa/Lagos" });

/** Plain words for each verdict, so the page never depends on colour to say what is wrong. */
const JOB_WORDS: Record<JobHealth, string> = {
  ok: "Running normally",
  late: "LATE: has not run recently",
  failing: "FAILING: its last run ended in an error",
  never_run: "NEVER RUN: no sign of it yet",
};

const WORKER_WORDS = {
  ok: "The background worker is running normally.",
  degraded: "ATTENTION: the background worker has a problem. Deadlines may not be enforced and messages may not be sent.",
  unknown: "The background worker has not reported in yet. If the system has been running for a few minutes, check that the worker is started.",
} as const;

export default async function HealthPage() {
  await requirePlatformAdminPage("/admin/health");
  const health = await getSystemHealth(getDb(), systemClock);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-6">
      <Link href="/admin" className="underline focus-visible:outline-2 focus-visible:outline-offset-2">Administration</Link>
      <h1 className="text-2xl font-semibold">System health</h1>
      <p role={health.worker === "degraded" ? "alert" : "status"} className="rounded-md border border-current p-3">
        {WORKER_WORDS[health.worker]}
      </p>

      <h2 className="text-lg font-semibold">Background jobs</h2>
      <div
        className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2"
        tabIndex={0}
        role="region"
        aria-label="Background jobs table (scrolls sideways on small screens)"
      >
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">Background jobs and when each last ran</caption>
          <thead>
            <tr>
              <th scope="col" className="border border-current p-2">Job</th>
              <th scope="col" className="border border-current p-2">What it does</th>
              <th scope="col" className="border border-current p-2">Should run every</th>
              <th scope="col" className="border border-current p-2">Last ran</th>
              <th scope="col" className="border border-current p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {health.jobs.map((job) => (
              <tr key={job.job}>
                <th scope="row" className="border border-current p-2 font-medium">{job.job}</th>
                <td className="border border-current p-2">{job.description}</td>
                <td className="border border-current p-2">{job.expectedEveryMinutes} min</td>
                <td className="border border-current p-2">
                  {job.lastRunAt ? (
                    <time dateTime={job.lastRunAt.toISOString()}>{dateTimeFormat.format(job.lastRunAt)}</time>
                  ) : (
                    "Never"
                  )}
                </td>
                <td className="border border-current p-2">{JOB_WORDS[job.health]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="text-lg font-semibold">Messages (email and SMS)</h2>
      <dl className="flex flex-col gap-2">
        <div><dt className="font-medium">Waiting to be sent</dt><dd>{health.notifications.pending}</dd></div>
        <div>
          <dt className="font-medium">Stuck (due more than 15 minutes ago)</dt>
          <dd>{health.notifications.stuck === 0 ? "None" : `${health.notifications.stuck}: the sender may not be running`}</dd>
        </div>
        <div>
          <dt className="font-medium">Longest overdue to send</dt>
          <dd>{health.notifications.oldestDueMinutes === null ? "Nothing is due" : `${health.notifications.oldestDueMinutes} minute(s)`}</dd>
        </div>
        <div><dt className="font-medium">Failed for good</dt><dd>{health.notifications.failed}</dd></div>
      </dl>

      <h2 className="text-lg font-semibold">Photo deletions (from erased accounts)</h2>
      <dl className="flex flex-col gap-2">
        <div><dt className="font-medium">Waiting</dt><dd>{health.photoDeletions.pending}</dd></div>
        <div>
          <dt className="font-medium">Failed: need a person to look</dt>
          <dd>{health.photoDeletions.failed === 0 ? "None" : `${health.photoDeletions.failed}`}</dd>
        </div>
      </dl>
    </main>
  );
}
