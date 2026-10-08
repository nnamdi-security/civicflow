import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { SlaNotice } from "@/components/sla-notice";
import { StatusBadge } from "@/components/status-badge";
import { systemClock } from "@/domain/clock";
import { overdueTimers } from "@/domain/sla";
import { canViewTriageQueue } from "@/domain/permissions";
import { getActor } from "@/server/auth/guards";
import { getDb } from "@/server/db";
import { listTriageReports } from "@/server/repositories/report-workflow";

const dateFormat = new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeZone: "Africa/Lagos" });

export default async function TriagePage() {
  const actor = await getActor();
  if (!actor) redirect("/sign-in?next=%2Fadmin%2Ftriage");
  if (!canViewTriageQueue(actor)) notFound();

  const reports = await listTriageReports(getDb());

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">Unrouted reports</h1>
      <p>No agency covers these locations for their category. Open a report to assign an agency.</p>
      <Link href="/agency" className="underline focus-visible:outline-2 focus-visible:outline-offset-2">
        All reports
      </Link>
      {reports.length === 0 ? (
        <p>Nothing is waiting for triage.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {reports.map((report) => (
            <li key={report.id} className="rounded-md border border-current p-3">
              <Link
                href={`/agency/reports/${report.id}`}
                className="font-medium underline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {report.reference}: {report.categoryName}
              </Link>
              <p className="mt-1 line-clamp-2">{report.description}</p>
              <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <StatusBadge status={report.status} />
                <span>Sent {dateFormat.format(report.createdAt)}</span>
              </p>
              <SlaNotice
                overdue={overdueTimers(report, systemClock)}
                ackLevel={report.ackLevel}
                resolveLevel={report.resolveLevel}
                audience="staff"
              />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
