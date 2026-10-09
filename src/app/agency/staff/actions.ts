"use server";

/**
 * Form handlers for the staff screen: inviting a person, and deactivating/reactivating one.
 *
 * Important detail about trust: whatever a browser sends can be edited by the person using it.
 * So for an AGENCY ADMIN these handlers ignore the role and agency from the form entirely and use
 * what the SESSION says (an officer, in the admin's own agency). Only a platform admin's choices
 * are read from the form. The use case then checks permission again, as a second lock on the door.
 */
import { redirect } from "next/navigation";
import { requireActor } from "@/server/auth/guards";
import { getDb } from "@/server/db";
import { inviteStaff, setStaffActive } from "@/server/admin/staff";

function text(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

export async function inviteStaffAction(formData: FormData): Promise<void> {
  const actor = await requireActor();

  // A platform admin chooses role and agency in the form. An agency admin never does.
  const isPlatformAdmin = actor.role === "platform_admin";
  const chosenAgency = text(formData, "agencyId");
  const result = await inviteStaff({ db: getDb() }, actor, {
    email: text(formData, "email") ?? "",
    role: isPlatformAdmin ? text(formData, "role") : "agency_officer",
    agencyId: isPlatformAdmin ? (chosenAgency ? chosenAgency : null) : actor.agencyId,
  });
  redirect(`/agency/staff?notice=${result.ok ? "invited" : result.reason}`);
}

export async function setStaffActiveAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const result = await setStaffActive({ db: getDb() }, actor, {
    userId: text(formData, "userId"),
    // The button's value is the word "on" (reactivate) or "off" (deactivate).
    active: text(formData, "state") === "on",
  });
  const code = result.ok ? (result.changed ? (text(formData, "state") === "on" ? "reactivated" : "deactivated") : "unchanged") : result.reason;
  redirect(`/agency/staff?notice=${code}`);
}
