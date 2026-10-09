/**
 * The page shown for any address that does not exist, and for anything the app deliberately
 * answers "not found" to (for example admin pages for people who are not admins, or another
 * person's report). Because it is the same page in every case, it reveals nothing about WHY.
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
