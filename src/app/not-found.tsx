/**
 * The page shown for any address that does not exist, and for anything the app deliberately
 * answers "not found" to (for example admin pages for people who are not admins, or another
 * person's report). Because it is the same page in every case, it reveals nothing about WHY.
 *
 * WARNING FOR FUTURE CHANGES: do NOT add a root-level `loading.tsx` (or wrap pages in a
 * <Suspense> that holds their data checks). A loading boundary makes Next.js start sending the
 * response before the page has decided whether it exists, so the HTTP status is already "200" by
 * the time `notFound()` runs (see the Next.js docs on loading.js "Status Codes"). Pages that
 * should be invisible to someone (an admin page, another person's report) would then answer 200
 * while a truly missing address answers 404, which lets anyone tell the difference. The
 * end-to-end tests assert a real 404 for these cases and will fail if this is reintroduced.
 */
import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p>We could not find that page. Check the address, or go back to the start.</p>
      <div className="flex flex-wrap gap-4">
        <Link href="/" className="underline focus-visible:outline-2 focus-visible:outline-offset-2">
          Go to the home page
        </Link>
        <Link href="/track" className="underline focus-visible:outline-2 focus-visible:outline-offset-2">
          Track a report
        </Link>
      </div>
    </main>
  );
}
