import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicTimeline } from "@/components/public-timeline";
import { StatusBadge } from "@/components/status-badge";
import { clientAddress } from "@/server/auth/sign-in-limits";
import { getPublicLookupDeps } from "@/server/reports/public-deps";
import { lookupPublicReport } from "@/server/reports/public-lookup";

// Per-report pages are found by code, not by search engines.
export const metadata: Metadata = {
  title: "Report progress",
  robots: { index: false, follow: false },
};

const dateTimeFormat = new Intl.DateTimeFormat("en-NG", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Lagos",
});

export default async function PublicReportPage({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  const result = await lookupPublicReport(getPublicLookupDeps(), clientAddress(await headers()), reference);

  if (!result.ok && result.reason === "rate_limited") {
    return (
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 p-6">
        <h1 className="text-2xl font-semibold">Please wait a moment</h1>
        <p role="alert">Too many lookups from your connection. Try again in a few minutes.</p>
      </main>
    );
  }
  if (!result.ok) notFound();

  const { report } = result;
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 p-6">
      <Link href="/track" className="underline focus-visible:outline-2 focus-visible:outline-offset-2">
        Track another report
      </Link>
      <h1 className="text-2xl font-semibold">Report {report.reference}</h1>
      <p className="flex flex-wrap items-center gap-2">
        <StatusBadge status={report.status} />
        <span>Sent {dateTimeFormat.format(report.createdAt)}</span>
      </p>

      {report.sla?.publiclyOverdue ? (
        <p className="rounded-md border border-current p-2 text-sm font-medium">This report is marked publicly overdue.</p>
      ) : null}
      {report.sla?.overdue.map((timer) => (
        <p key={timer} className="rounded-md border border-current p-2 text-sm font-medium">
          Overdue: the agency has not yet {timer === "acknowledge" ? "acknowledged" : "resolved"} this report.
        </p>
      ))}

      <dl className="flex flex-col gap-3">
        <div>
          <dt className="font-medium">Category</dt>
          <dd>{report.categoryName}</dd>
        </div>
        <div>
          <dt className="font-medium">Handled by</dt>
          <dd>{report.agencyName ?? "Not assigned to an agency yet"}</dd>
        </div>
        <div>
          <dt className="font-medium">Area</dt>
          <dd>{report.areaName ?? "Not recorded"}</dd>
        </div>
        {report.sla?.acknowledgeBy ? (
          <div>
            <dt className="font-medium">Agency should acknowledge by</dt>
            <dd>
              <time dateTime={report.sla.acknowledgeBy.toISOString()}>{dateTimeFormat.format(report.sla.acknowledgeBy)}</time>
            </dd>
          </div>
        ) : null}
        {report.sla?.resolveBy ? (
          <div>
            <dt className="font-medium">Agency should resolve by</dt>
            <dd>
              <time dateTime={report.sla.resolveBy.toISOString()}>{dateTimeFormat.format(report.sla.resolveBy)}</time>
            </dd>
          </div>
        ) : null}
      </dl>

      <h2 className="text-lg font-semibold">Progress</h2>
      <PublicTimeline entries={report.timeline} />
    </main>
  );
}
