"use client";

/**
 * The page shown when something unexpected goes wrong while a page is being built or used
 * (Next.js calls this an "error boundary"). It must be a "client component" (hence the
 * "use client" line above) so the "Try again" button can work in the browser.
 *
 * Two deliberate choices:
 *   - It never shows the technical error message. Error text can mention table names, ids or other
 *     details that are useful to an attacker and meaningless to a resident.
 *   - It shows `error.digest`: a short opaque reference that Next.js also writes to the server
 *     log next to the real error. A resident can quote it to support, and the team can find the
 *     exact failure in the logs, without the reference itself revealing anything.
 */
import Link from "next/link";

export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  /**
   * Asks Next.js to fetch and render the page again. (In this version of Next.js `retry` is the
   * recommended way; the older `reset` only clears the error without re-fetching.)
   */
  retry: () => void;
}) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p>
        Sorry, we could not show this page. Nothing you entered has been lost or sent twice. You can try again, or go
        back to the start.
      </p>
      {error.digest ? <p className="text-sm">Reference for support: {error.digest}</p> : null}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => retry()}
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-foreground px-4 py-2 text-base font-medium text-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
        >
          Try again
        </button>
        <Link href="/" className="inline-flex min-h-11 items-center underline focus-visible:outline-2 focus-visible:outline-offset-2">
          Go to the home page
        </Link>
      </div>
    </main>
  );
}
