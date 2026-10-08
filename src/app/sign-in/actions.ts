"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { z } from "zod";
import { signIn } from "@/server/auth";
import { safeRedirectPath } from "@/server/auth/redirect";
import { allowSignInAttempt } from "@/server/auth/sign-in-limits";

const emailSchema = z.email();

export async function requestSignIn(formData: FormData): Promise<void> {
  const next = safeRedirectPath(formData.get("next"));
  const nextQuery = next === "/account" ? "" : `&next=${encodeURIComponent(next)}`;

  const parsed = emailSchema.safeParse(String(formData.get("email") ?? "").trim());
  if (!parsed.success) redirect(`/sign-in?error=invalid${nextQuery}`);

  if (!(await allowSignInAttempt(await headers()))) redirect(`/sign-in?error=failed${nextQuery}`);

  try {
    await signIn("email", { email: parsed.data, redirectTo: next });
  } catch (error) {
    // signIn redirects on success by throwing; only Auth.js failures are ours to handle.
    if (error instanceof AuthError) redirect(`/sign-in?error=failed${nextQuery}`);
    throw error;
  }
}
