"use client";

/**
 * The last-resort error page. It is used only when the page frame itself (the root layout) fails,
 * so it has to supply its own <html> and <body> tags. It is deliberately plain: if the frame is
 * broken, we want as little as possible that can break again. Like error.tsx it shows only a
 * generic message and the opaque support reference, never the technical error.
 */
import "./globals.css";

export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 p-6">
          <h1 className="text-2xl font-semibold">Something went wrong</h1>
          <p>Sorry, CivicFlow is not working right now. Please try again in a few minutes.</p>
          {error.digest ? <p className="text-sm">Reference for support: {error.digest}</p> : null}
          <button
            type="button"
            onClick={() => retry()}
            className="inline-flex min-h-11 items-center justify-center self-start rounded-md bg-foreground px-4 py-2 text-base font-medium text-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
