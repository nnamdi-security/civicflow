"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { z } from "zod";
import { signIn } from "@/server/auth";
import { allowSignInAttempt } from "@/server/auth/sign-in-limits";

const emailSchema = z.email();

export async function requestSignIn(formData: FormData): Promise<void> {
  const parsed = emailSchema.safeParse(String(formData.get("email") ?? "").trim());
  if (!parsed.success) redirect("/sign-in?error=invalid");

  if (!(await allowSignInAttempt(await headers()))) redirect("/sign-in?error=failed");

  try {
    await signIn("email", { email: parsed.data, redirectTo: "/account" });
  } catch (error) {
    // signIn redirects on success by throwing; only Auth.js failures are ours to handle.
    if (error instanceof AuthError) redirect("/sign-in?error=failed");
    throw error;
  }
}
