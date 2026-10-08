import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
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

const dateTimeFormat = new Intl.DateTimeFormat("en-NG", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Lagos",
});

export default async function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getActor();
  if (!actor) redirect(`/sign-in?next=${encodeURIComponent(`/reports/${id}`)}`);

  // Another reporter's report and a missing one look identical: both are a 404.
  if (!z.uuid().safeParse(id).success) notFound();
  const report = await findReportForReporter(getDb(), id, actor.userId);
  if (!report) notFound();

  const history = await listStatusHistory(getDb(), report.id);
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
