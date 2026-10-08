import { SIGN_IN_LINK_MAX_AGE_SECONDS } from "@/server/auth/constants";

export default function CheckEmailPage() {
  const minutes = SIGN_IN_LINK_MAX_AGE_SECONDS / 60;
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-3 p-6">
      <h1 className="text-2xl font-semibold">Check your email</h1>
      <p>
        If the address is valid, a sign-in link is on its way. It works once and expires in{" "}
        {minutes} minutes.
      </p>
      <a href="/sign-in" className="underline focus-visible:outline-2 focus-visible:outline-offset-2">
        Use a different email
      </a>
    </main>
  );
}
