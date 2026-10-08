"use server";

import { redirect } from "next/navigation";
import { getPhoneDeps } from "@/server/account/deps";
import { updateNotificationPreferences } from "@/server/account/preferences";
import { confirmPhoneVerification, removePhone, startPhoneVerification } from "@/server/account/phone";
import { signOut } from "@/server/auth";
import { requireActor } from "@/server/auth/guards";

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
}

function text(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

function back(notice: string): never {
  redirect(`/account?notice=${notice}`);
}

/** Sends a verification code. Authorization and limits live in the use case. */
export async function startPhoneAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const result = await startPhoneVerification(getPhoneDeps(), actor, { phone: text(formData, "phone") });
  back(result.ok ? "code_sent" : result.reason);
}

export async function confirmPhoneAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const result = await confirmPhoneVerification(getPhoneDeps(), actor, { code: text(formData, "code") });
  back(result.ok ? "phone_verified" : result.reason);
}

export async function removePhoneAction(): Promise<void> {
  const actor = await requireActor();
  await removePhone(getPhoneDeps(), actor);
  back("phone_removed");
}

export async function savePreferencesAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const result = await updateNotificationPreferences(getPhoneDeps(), actor, {
    notifyEmail: formData.get("notifyEmail") === "on",
    notifySms: formData.get("notifySms") === "on",
  });
  back(result.ok ? "preferences_saved" : result.reason);
}
