import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/button";
import { safeRedirectPath } from "@/server/auth/redirect";
import { getActor } from "@/server/auth/guards";
import { requestSignIn } from "./actions";

const ERRORS: Record<string, string> = {
  invalid: "Enter a valid email address.",
  failed: "We could not send the link. Wait a few minutes and try again.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const params = await searchParams;
  const next = safeRedirectPath(params.next);
  if (await getActor()) redirect(next);

  const message = params.error ? ERRORS[params.error] : undefined;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p>Enter your email and we will send you a one-time sign-in link.</p>
      {message ? (
        <p role="alert" className="rounded-md border border-current p-3">
          Error: {message}
        </p>
      ) : null}
      <form action={requestSignIn} className="flex flex-col gap-3">
        <input type="hidden" name="next" value={next} />
        <label htmlFor="email" className="font-medium">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="min-h-11 rounded-md border border-current bg-background px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2"
        />
        <Button type="submit">Send sign-in link</Button>
      </form>
      <p className="text-sm">
        Read our{" "}
        <Link href="/privacy" className="underline focus-visible:outline-2 focus-visible:outline-offset-2">
          privacy notice
        </Link>{" "}
        and{" "}
        <Link href="/terms" className="underline focus-visible:outline-2 focus-visible:outline-offset-2">
          terms of use
        </Link>
        .
      </p>
    </main>
  );
}
