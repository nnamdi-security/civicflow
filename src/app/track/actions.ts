"use server";

import { redirect } from "next/navigation";
import { REFERENCE_PATTERN } from "@/domain/reports/reference";
import { normalizeReference } from "@/server/reports/public-lookup";

/** Sends the visitor to the tracking page for the code they typed. The lookup itself is rate limited there. */
export async function findReportAction(formData: FormData): Promise<void> {
  const value = formData.get("reference");
  const reference = typeof value === "string" ? normalizeReference(value.slice(0, 40)) : "";
  if (!REFERENCE_PATTERN.test(reference)) redirect("/track?error=invalid");
  redirect(`/track/${reference}`);
}
