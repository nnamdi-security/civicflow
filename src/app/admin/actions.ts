"use server";

/**
 * The form handlers ("server actions") for the platform-admin screens.
 *
 * Each exported function is what runs on the server when an admin presses a button. They do three
 * small jobs and nothing more:
 *   1. find out who is signed in;
 *   2. read the form fields and hand them to the matching "use case" in src/server/admin/ (the
 *      use case checks permission, validates, saves and writes the audit entry);
 *   3. send the browser back to a page with a short `?notice=` code saying what happened.
 *
 * The rules (who may do this, what is valid) are NOT here on purpose: they live in the use
 * cases, so they apply no matter how a request arrives.
 */
import { redirect } from "next/navigation";
import { requireActor } from "@/server/auth/guards";
import { getDb } from "@/server/db";
import { addCoverage, createAgency, removeCoverage, setCoveragePriority, updateAgency } from "@/server/admin/agencies";
import { setCategoryActive } from "@/server/admin/categories";
import { updateSlaPolicy } from "@/server/admin/sla-policy";

/** Reads a text field from a submitted form, or undefined if it is missing or is a file. */
function text(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

/**
 * Reads a number field. A blank box becomes undefined (NOT zero!): in JavaScript `Number("")` is 0,
 * which would silently turn an empty "priority" box into priority 0. Anything that is not a
 * number becomes NaN, which the use cases reject.
 */
function numberField(formData: FormData, name: string): number | undefined {
  const value = text(formData, name);
  if (value === undefined || value.trim() === "") return undefined;
  return Number(value);
}

export async function createAgencyAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const result = await createAgency({ db: getDb() }, actor, { name: text(formData, "name"), type: text(formData, "type") });
  if (!result.ok) redirect(`/admin/agencies?notice=${result.reason}`);
  // Go straight to the new agency so the admin can add coverage next.
  redirect(`/admin/agencies/${result.agencyId}?notice=agency_created`);
}

export async function updateAgencyAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const agencyId = text(formData, "agencyId") ?? "";
  const result = await updateAgency({ db: getDb() }, actor, {
    agencyId,
    name: text(formData, "name"),
    type: text(formData, "type"),
  });
  if (!result.ok && result.reason === "malformed") redirect("/admin/agencies?notice=malformed");
  redirect(`/admin/agencies/${agencyId}?notice=${result.ok ? (result.changed ? "agency_updated" : "unchanged") : result.reason}`);
}

export async function addCoverageAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const agencyId = text(formData, "agencyId") ?? "";
  const result = await addCoverage({ db: getDb() }, actor, {
    agencyId,
    jurisdictionId: text(formData, "jurisdictionId"),
    priority: numberField(formData, "priority"),
  });
  if (!result.ok && result.reason === "malformed") redirect("/admin/agencies?notice=malformed");
  redirect(`/admin/agencies/${agencyId}?notice=${result.ok ? "coverage_added" : result.reason}`);
}

export async function removeCoverageAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const agencyId = text(formData, "agencyId") ?? "";
  const result = await removeCoverage({ db: getDb() }, actor, { agencyId, jurisdictionId: text(formData, "jurisdictionId") });
  if (!result.ok && result.reason === "malformed") redirect("/admin/agencies?notice=malformed");
  redirect(`/admin/agencies/${agencyId}?notice=${result.ok ? "coverage_removed" : result.reason}`);
}

export async function setPriorityAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const agencyId = text(formData, "agencyId") ?? "";
  const result = await setCoveragePriority({ db: getDb() }, actor, {
    agencyId,
    jurisdictionId: text(formData, "jurisdictionId"),
    priority: numberField(formData, "priority"),
  });
  if (!result.ok && result.reason === "malformed") redirect("/admin/agencies?notice=malformed");
  redirect(`/admin/agencies/${agencyId}?notice=${result.ok ? (result.changed ? "priority_saved" : "unchanged") : result.reason}`);
}

export async function updateSlaPolicyAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const result = await updateSlaPolicy({ db: getDb() }, actor, {
    categoryId: text(formData, "categoryId"),
    ackMinutes: numberField(formData, "ackMinutes"),
    resolveMinutes: numberField(formData, "resolveMinutes"),
    note: text(formData, "note"),
  });
  redirect(`/admin/sla?notice=${result.ok ? (result.changed ? "sla_saved" : "unchanged") : result.reason}`);
}

export async function setCategoryActiveAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const result = await setCategoryActive({ db: getDb() }, actor, {
    categoryId: text(formData, "categoryId"),
    // The button's value is the word "on" or "off".
    active: text(formData, "state") === "on",
  });
  redirect(`/admin/categories?notice=${result.ok ? (result.changed ? "category_saved" : "unchanged") : result.reason}`);
}
