import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { SlaNotice } from "@/components/sla-notice";
import { StatusBadge } from "@/components/status-badge";
import { systemClock } from "@/domain/clock";
import { overdueTimers } from "@/domain/sla";
import { agencyScopeFor, canViewTriageQueue } from "@/domain/permissions";
import { getActor } from "@/server/auth/guards";
import { getDb } from "@/server/db";
import { listReportsForScope } from "@/server/repositories/report-workflow";

const dateFormat = new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeZone: "Africa/Lagos" });

export default async function AgencyInboxPage() {
  const actor = await getActor();
  if (!actor) redirect("/sign-in?next=%2Fagency");

  // The scope is applied inside the query; residents have none and see nothing here.
  const scope = agencyScopeFor(actor);
  if (scope.kind === "none") notFound();
  const reports = await listReportsForScope(getDb(), scope);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">{scope.kind === "all" ? "All reports" : "Your agency's reports"}</h1>
      {canViewTriageQueue(actor) ? (
        <Link href="/admin/triage" className="underline focus-visible:outline-2 focus-visible:outline-offset-2">
          Unrouted reports (triage)
        </Link>
      ) : null}
      {reports.length === 0 ? (
        <p>There are no reports to show.</p>
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
                {scope.kind === "all" ? <span>Agency: {report.agencyName ?? "none yet"}</span> : null}
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
