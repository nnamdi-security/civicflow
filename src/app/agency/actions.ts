"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { systemClock } from "@/domain/clock";
import { requireActor } from "@/server/auth/guards";
import { getDb } from "@/server/db";
import { changeReportStatus } from "@/server/reports/change-status";
import { reassignReport } from "@/server/reports/reassign-report";

const idSchema = z.uuid();

function text(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

function detailUrl(reportId: string, notice: string) {
  return `/agency/reports/${reportId}?notice=${notice}`;
}

/** Staff status buttons. Authorization lives in the use case; this only relays the form. */
export async function changeStatusAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const reportId = idSchema.safeParse(text(formData, "reportId"));
  if (!reportId.success) redirect("/agency");

  const result = await changeReportStatus({ db: getDb(), clock: systemClock }, actor, {
    reportId: reportId.data,
    to: text(formData, "to"),
    reason: text(formData, "reason"),
  });
  redirect(detailUrl(reportId.data, result.ok ? "status_updated" : result.reason));
}

/** Triage and reassignment form. Returns to the page the form came from. */
export async function reassignAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const reportId = idSchema.safeParse(text(formData, "reportId"));
  if (!reportId.success) redirect("/agency");

  const result = await reassignReport({ db: getDb(), clock: systemClock }, actor, {
    reportId: reportId.data,
    agencyId: text(formData, "agencyId"),
    reason: text(formData, "reason"),
  });
  redirect(detailUrl(reportId.data, result.ok ? "reassigned" : result.reason));
}
