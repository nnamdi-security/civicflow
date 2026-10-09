import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { Button } from "@/components/button";
import { SlaNotice } from "@/components/sla-notice";
import { StatusBadge } from "@/components/status-badge";
import { StatusHistory } from "@/components/status-history";
import { systemClock } from "@/domain/clock";
import { overdueTimers } from "@/domain/sla";
import { getActor } from "@/server/auth/guards";
import { getDb } from "@/server/db";
import { listStatusHistory } from "@/server/repositories/report-workflow";
import { findReportForReporter } from "@/server/repositories/reports";
import { getMediaStorage } from "@/server/reports/deps";
import { answerResolutionAction } from "./actions";
import { noticeFor } from "./messages";

const dateTimeFormat = new Intl.DateTimeFormat("en-NG", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Lagos",
});

export default async function ReportDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { id } = await params;
  const { notice } = await searchParams;
  const actor = await getActor();
  if (!actor) redirect(`/sign-in?next=${encodeURIComponent(`/reports/${id}`)}`);

  // Another reporter's report and a missing one look identical: both are a 404.
  if (!z.uuid().safeParse(id).success) notFound();
  const report = await findReportForReporter(getDb(), id, actor.userId);
  if (!report) notFound();

  const history = await listStatusHistory(getDb(), report.id);
  const message = noticeFor(notice);
  const media = getMediaStorage();
  const mapLink = `https://www.openstreetmap.org/?mlat=${report.lat}&mlon=${report.lon}#map=17/${report.lat}/${report.lon}`;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 p-6">
      <Link href="/reports" className="underline focus-visible:outline-2 focus-visible:outline-offset-2">
        All my reports
      </Link>
      <h1 className="text-2xl font-semibold">Report {report.reference}</h1>
      <p className="flex flex-wrap items-center gap-2">
        <StatusBadge status={report.status} />
        <span>Sent {dateTimeFormat.format(report.createdAt)}</span>
      </p>

      {message ? (
        <p role={message.ok ? "status" : "alert"} className="rounded-md border border-current p-3">
          {message.ok ? "" : "Error: "}
          {message.text}
        </p>
      ) : null}

      {report.status === "resolved" ? (
        <form action={answerResolutionAction} className="flex flex-col gap-3 rounded-md border border-current p-3">
          <h2 className="text-lg font-semibold">Has this been fixed?</h2>
          <p>The agency says it has dealt with this problem. Please check the location and tell us.</p>
          <input type="hidden" name="reportId" value={report.id} />
          <label className="flex flex-col gap-1">
            <span className="font-medium">If it is not fixed, what is still wrong? (required to say it is not fixed)</span>
            <textarea
              name="reason"
              rows={3}
              maxLength={500}
              className="min-h-11 rounded-md border border-current bg-transparent px-3 py-2"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" name="answer" value="confirmed">
              Yes, it is fixed
            </Button>
            <Button type="submit" name="answer" value="disputed">
              No, it is not fixed
            </Button>
          </div>
        </form>
      ) : null}

      <SlaNotice
        overdue={overdueTimers(report, systemClock)}
        ackLevel={report.ackLevel}
        resolveLevel={report.resolveLevel}
        audience="resident"
      />

      <dl className="flex flex-col gap-3">
        <div>
          <dt className="font-medium">Category</dt>
          <dd>{report.categoryName}</dd>
        </div>
        <div>
          <dt className="font-medium">Handled by</dt>
          <dd>{report.agencyName ?? "Not assigned to an agency yet"}</dd>
        </div>
        {report.ackDueAt ? (
          <div>
            <dt className="font-medium">Agency should acknowledge by</dt>
            <dd>
              <time dateTime={report.ackDueAt.toISOString()}>{dateTimeFormat.format(report.ackDueAt)}</time>
            </dd>
          </div>
        ) : null}
        {report.resolveDueAt ? (
          <div>
            <dt className="font-medium">Agency should resolve by</dt>
            <dd>
              <time dateTime={report.resolveDueAt.toISOString()}>{dateTimeFormat.format(report.resolveDueAt)}</time>
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="font-medium">Public tracking page</dt>
          <dd>
            <Link href={`/track/${report.reference}`} className="underline">
              /track/{report.reference}
            </Link>{" "}
            (shows progress only, never your details)
          </dd>
        </div>
        <div>
          <dt className="font-medium">Description</dt>
          {/* Plain text: React escapes it; whitespace-pre-wrap keeps the reporter's line breaks. */}
          <dd className="whitespace-pre-wrap">{report.description}</dd>
        </div>
        <div>
          <dt className="font-medium">Location</dt>
          <dd>
            {report.lat.toFixed(5)}, {report.lon.toFixed(5)} ·{" "}
            <a href={mapLink} className="underline" rel="noopener noreferrer" target="_blank">
              View on OpenStreetMap
            </a>
          </dd>
        </div>
      </dl>

      <h2 className="text-lg font-semibold">Progress</h2>
      <StatusHistory entries={history} />

      <h2 className="text-lg font-semibold">Photos</h2>
      <ul className="flex flex-col gap-3">
        {report.photos.map((photo, index) => (
          <li key={photo.publicId}>
            {/* eslint-disable-next-line @next/next/no-img-element -- the provider already resizes via URL transforms */}
            <img
              src={media.imageUrl(photo.publicId, { width: 640 })}
              alt={`Photo ${index + 1} of the reported problem`}
              width={photo.width}
              height={photo.height}
              loading="lazy"
              className="h-auto max-w-full rounded-md"
            />
          </li>
        ))}
      </ul>
    </main>
  );
}
