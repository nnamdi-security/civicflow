"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { systemClock } from "@/domain/clock";
import { requireActor } from "@/server/auth/guards";
import { getDb } from "@/server/db";
import { changeReportStatus } from "@/server/reports/change-status";

const idSchema = z.uuid();
const answers = { confirmed: "confirmed", disputed: "disputed" } as const;

function text(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

/**
 * The resident's answer to "is it fixed?". Only the reporter can confirm or dispute: the use
 * case and state machine decide, this only relays the form. A dispute needs a note.
 */
export async function answerResolutionAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const reportId = idSchema.safeParse(text(formData, "reportId"));
  if (!reportId.success) redirect("/reports");

  const answer = text(formData, "answer");
  const to = answer !== undefined && Object.hasOwn(answers, answer) ? answers[answer as keyof typeof answers] : null;
  if (to === null) redirect(`/reports/${reportId.data}?notice=malformed`);

  const result = await changeReportStatus({ db: getDb(), clock: systemClock }, actor, {
    reportId: reportId.data,
    to,
    reason: to === "disputed" ? text(formData, "reason") : undefined,
  });
  redirect(`/reports/${reportId.data}?notice=${result.ok ? to : result.reason}`);
}
