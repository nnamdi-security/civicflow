import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { Button } from "@/components/button";
import { StatusBadge } from "@/components/status-badge";
import { StatusHistory } from "@/components/status-history";
import { agencyScopeFor, canReassignReports } from "@/domain/permissions";
import { allowedTargets, validateReassignment, validateTransition } from "@/domain/reports/transitions";
import { getActor } from "@/server/auth/guards";
import { getDb } from "@/server/db";
import {
  findReportForScope,
  listAgencyOptions,
  listReportPhotos,
  listStatusHistory,
} from "@/server/repositories/report-workflow";
import { getMediaStorage } from "@/server/reports/deps";
import { changeStatusAction, reassignAction } from "../../actions";
import { noticeFor } from "../../messages";

const dateTimeFormat = new Intl.DateTimeFormat("en-NG", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Lagos",
});

const ACTION_LABELS: Record<string, string> = {
  acknowledged: "Acknowledge",
  in_progress: "Start work",
  resolved: "Mark resolved",
  rejected: "Reject",
};

const fieldClass = "min-h-11 rounded-md border border-current bg-transparent px-3 py-2";

export default async function AgencyReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { id } = await params;
  const { notice } = await searchParams;
  const actor = await getActor();
  if (!actor) redirect(`/sign-in?next=${encodeURIComponent(`/agency/reports/${id}`)}`);

  // Outside the actor's scope, a report looks exactly like one that does not exist.
  if (!z.uuid().safeParse(id).success) notFound();
  const db = getDb();
  const report = await findReportForScope(db, id, agencyScopeFor(actor));
  if (!report) notFound();

  const [history, photos] = await Promise.all([listStatusHistory(db, id), listReportPhotos(db, id)]);

  // Offer only the moves the domain would accept for this actor right now.
  const transitionActor = { kind: "user", role: actor.role, agencyId: actor.agencyId, isReporter: false } as const;
  const actions = allowedTargets(report.status).filter(
    (to) =>
      to !== "routed" &&
      validateTransition({ from: report.status, to, actor: transitionActor, reportAgencyId: report.agencyId, reason: "x" }).ok,
  );
  const canReassign =
    canReassignReports(actor) &&
    validateReassignment({ from: report.status, actor: transitionActor, reportAgencyId: report.agencyId }).ok;
  const agencyOptions = canReassign ? (await listAgencyOptions(db)).filter((a) => a.id !== report.agencyId) : [];

  const media = getMediaStorage();
  const message = noticeFor(notice);
  const mapLink = `https://www.openstreetmap.org/?mlat=${report.lat}&mlon=${report.lon}#map=17/${report.lat}/${report.lon}`;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-6">
      <Link href="/agency" className="underline focus-visible:outline-2 focus-visible:outline-offset-2">
        All reports
      </Link>
      <h1 className="text-2xl font-semibold">Report {report.reference}</h1>
      {message ? (
        <p role={message.ok ? "status" : "alert"} className="rounded-md border border-current p-3">
          {message.ok ? "" : "Error: "}
          {message.text}
        </p>
      ) : null}
      <p className="flex flex-wrap items-center gap-2">
        <StatusBadge status={report.status} />
        <span>Sent {dateTimeFormat.format(report.createdAt)}</span>
      </p>

      <dl className="flex flex-col gap-3">
        <div>
          <dt className="font-medium">Category</dt>
          <dd>{report.categoryName}</dd>
        </div>
        <div>
          <dt className="font-medium">Agency</dt>
          <dd>{report.agencyName ?? "Not assigned yet"}</dd>
        </div>
        <div>
          <dt className="font-medium">Description</dt>
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

      {actions.length > 0 ? (
        <form action={changeStatusAction} className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Update status</h2>
          <input type="hidden" name="reportId" value={report.id} />
          <label className="flex flex-col gap-1">
            <span className="font-medium">Note (required to reject)</span>
            <textarea name="reason" maxLength={500} rows={2} className={fieldClass} />
          </label>
          <div className="flex flex-wrap gap-2">
            {actions.map((to) => (
              <Button key={to} type="submit" name="to" value={to}>
                {to === "in_progress" && report.status === "disputed" ? "Reopen" : (ACTION_LABELS[to] ?? to)}
              </Button>
            ))}
          </div>
        </form>
      ) : null}

      {canReassign ? (
        <form action={reassignAction} className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{report.agencyId ? "Reassign to another agency" : "Assign an agency"}</h2>
          <input type="hidden" name="reportId" value={report.id} />
          <label className="flex flex-col gap-1">
            <span className="font-medium">Agency</span>
            <select name="agencyId" required defaultValue="" className={fieldClass}>
              <option value="" disabled>
                Choose an agency
              </option>
              {agencyOptions.map((agency) => (
                <option key={agency.id} value={agency.id}>
                  {agency.name} ({agency.type})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium">Reason (optional)</span>
            <input name="reason" maxLength={500} className={fieldClass} />
          </label>
          <Button type="submit" className="self-start">
            {report.agencyId ? "Reassign" : "Assign"}
          </Button>
        </form>
      ) : null}

      <h2 className="text-lg font-semibold">History</h2>
      <StatusHistory entries={history} />

      <h2 className="text-lg font-semibold">Photos</h2>
      <ul className="flex flex-col gap-3">
        {photos.map((photo, index) => (
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
