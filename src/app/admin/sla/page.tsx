/**
 * SLA deadlines: /admin/sla. Platform admins only.
 *
 * "SLA" = the deadlines agencies are held to. For each category an admin sets how many MINUTES an
 * agency has to acknowledge a report and to resolve it. Changes apply only to timers that START
 * after the change; reports already waiting keep the deadline they were given. A written reason
 * is required and is saved in the audit log (ADR 0014).
 */
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/button";
import { Notice } from "@/components/notice";
import { formatDuration } from "@/domain/performance";
import { getDb } from "@/server/db";
import { listSlaPolicies } from "@/server/repositories/admin";
import { updateSlaPolicyAction } from "../actions";
import { requirePlatformAdminPage } from "../guard";
import { noticeFor } from "../messages";

export const metadata: Metadata = { title: "SLA deadlines", robots: { index: false, follow: false } };

const fieldClass = "min-h-11 rounded-md border border-current bg-transparent px-3 py-2";
const dateFormat = new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeZone: "Africa/Lagos" });

export default async function SlaPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams;
  await requirePlatformAdminPage("/admin/sla");
  const policies = await listSlaPolicies(getDb());

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-6">
      <Link href="/admin" className="underline focus-visible:outline-2 focus-visible:outline-offset-2">Administration</Link>
      <h1 className="text-2xl font-semibold">SLA deadlines</h1>
      <p>
        These are the deadlines agencies are held to. A change applies only to timers that start from now on; reports that
        are already waiting keep their current deadline. The values in use today are provisional until official targets are
        agreed.
      </p>
      <Notice notice={noticeFor(notice)} />

      {policies.map((policy) => (
        <form key={policy.categoryId} action={updateSlaPolicyAction} className="flex flex-col gap-3 rounded-md border border-current p-3">
          <h2 className="text-lg font-semibold">{policy.categoryName}</h2>
          <p className="text-sm">
            Now: acknowledge within {formatDuration(policy.ackMinutes)}, resolve within {formatDuration(policy.resolveMinutes)}.
            Last changed {dateFormat.format(policy.updatedAt)}.
          </p>
          <input type="hidden" name="categoryId" value={policy.categoryId} />
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1">
              <span className="font-medium">Acknowledge within (minutes)</span>
              <input name="ackMinutes" type="number" inputMode="numeric" min={5} max={43200} step={1} required defaultValue={policy.ackMinutes} className={`${fieldClass} w-40`} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-medium">Resolve within (minutes)</span>
              <input name="resolveMinutes" type="number" inputMode="numeric" min={5} max={525600} step={1} required defaultValue={policy.resolveMinutes} className={`${fieldClass} w-40`} />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="font-medium">Reason for the change (required; saved in the audit log)</span>
            <input name="note" required minLength={5} maxLength={500} className={fieldClass} />
          </label>
          <Button type="submit" className="self-start">Save {policy.categoryName}</Button>
        </form>
      ))}
    </main>
  );
}
