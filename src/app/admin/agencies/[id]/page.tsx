/**
 * One agency: /admin/agencies/<id>. Platform admins only.
 *
 * Here an admin can rename the agency, change its type, and manage the areas it covers.
 * "Coverage" decides where new reports are routed: an agency receives reports located inside the
 * areas it covers, and when two agencies cover the same place the one with the LOWER priority
 * number is tried first (docs/routing.md).
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Button } from "@/components/button";
import { Notice } from "@/components/notice";
import { AGENCY_TYPES } from "@/domain/agency-types";
import { getDb } from "@/server/db";
import { findAgencyDetail, listJurisdictionOptions } from "@/server/repositories/admin";
import { addCoverageAction, removeCoverageAction, setPriorityAction, updateAgencyAction } from "../../actions";
import { requirePlatformAdminPage } from "../../guard";
import { noticeFor } from "../../messages";

export const metadata: Metadata = { title: "Agency", robots: { index: false, follow: false } };

const fieldClass = "min-h-11 rounded-md border border-current bg-transparent px-3 py-2";

export default async function AgencyAdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { id } = await params;
  const { notice } = await searchParams;
  await requirePlatformAdminPage(`/admin/agencies/${id}`);

  // An address that is not even a valid id, or an agency that does not exist, is a plain 404.
  if (!z.uuid().safeParse(id).success) notFound();
  const db = getDb();
  const agency = await findAgencyDetail(db, id);
  if (!agency) notFound();

  // For the "add coverage" menu, offer only areas this agency does not already cover.
  const covered = new Set(agency.coverage.map((row) => row.jurisdictionId));
  const options = (await listJurisdictionOptions(db)).filter((option) => !covered.has(option.id));

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-6">
      <Link href="/admin/agencies" className="underline focus-visible:outline-2 focus-visible:outline-offset-2">All agencies</Link>
      <h1 className="text-2xl font-semibold">{agency.name}</h1>
      <Notice notice={noticeFor(notice)} />

      {/* ---- Rename / change type ---- */}
      <form action={updateAgencyAction} className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Details</h2>
        {/* A hidden field carries the agency id with the form; the server re-checks it. */}
        <input type="hidden" name="agencyId" value={agency.id} />
        <label className="flex flex-col gap-1">
          <span className="font-medium">Name</span>
          <input name="name" required minLength={2} maxLength={100} defaultValue={agency.name} className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Type</span>
          <select name="type" required defaultValue={agency.type} className={fieldClass}>
            {AGENCY_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </label>
        <p className="text-sm">Changing the type affects which new reports are routed here.</p>
        <Button type="submit" className="self-start">Save details</Button>
      </form>

      {/* ---- Areas this agency covers ---- */}
      <section aria-labelledby="coverage-heading" className="flex flex-col gap-3">
        <h2 id="coverage-heading" className="text-lg font-semibold">Areas covered</h2>
        {agency.coverage.length === 0 ? (
          <p>This agency covers no areas yet, so it will not receive reports automatically.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {agency.coverage.map((row) => (
              <li key={row.jurisdictionId} className="flex flex-col gap-2 rounded-md border border-current p-3">
                <span className="font-medium">
                  {row.jurisdictionName} ({row.level === "lga" ? "LGA" : "state"})
                </span>
                <div className="flex flex-wrap items-end gap-3">
                  {/* Change this area's priority. */}
                  <form action={setPriorityAction} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="agencyId" value={agency.id} />
                    <input type="hidden" name="jurisdictionId" value={row.jurisdictionId} />
                    <label className="flex flex-col gap-1">
                      <span className="text-sm">Priority (lower is tried first)</span>
                      <input
                        name="priority"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={1000}
                        step={1}
                        required
                        defaultValue={row.priority}
                        className={`${fieldClass} w-28`}
                      />
                    </label>
                    <Button type="submit">Save priority</Button>
                  </form>
                  {/* Stop covering this area. */}
                  <form action={removeCoverageAction}>
                    <input type="hidden" name="agencyId" value={agency.id} />
                    <input type="hidden" name="jurisdictionId" value={row.jurisdictionId} />
                    <Button type="submit">Remove</Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}

        {options.length > 0 ? (
          <form action={addCoverageAction} className="flex flex-col gap-3">
            <h3 className="font-medium">Add an area</h3>
            <input type="hidden" name="agencyId" value={agency.id} />
            <label className="flex flex-col gap-1">
              <span className="font-medium">Area</span>
              <select name="jurisdictionId" required defaultValue="" className={fieldClass}>
                <option value="" disabled>Choose an area</option>
                {options.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-medium">Priority (0 to 1000; lower is tried first)</span>
              <input name="priority" type="number" inputMode="numeric" min={0} max={1000} step={1} required defaultValue={0} className={`${fieldClass} w-28`} />
            </label>
            <Button type="submit" className="self-start">Add area</Button>
          </form>
        ) : (
          <p className="text-sm">There are no more areas to add.</p>
        )}
      </section>
    </main>
  );
}
