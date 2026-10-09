import Link from "next/link";

const linkClass = "underline focus-visible:outline-2 focus-visible:outline-offset-2";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ erased?: string }> }) {
  const { erased } = await searchParams;
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-3 p-6">
      {erased === "1" ? (
        <p role="status" className="rounded-md border border-current p-3">
          Your account has been deleted. We sent a confirmation to your email address.
        </p>
      ) : null}
      <h1 className="text-3xl font-semibold">CivicFlow</h1>
      <p className="text-base">
        Report civic issues, track the response, and hold agencies accountable.
      </p>
      <nav aria-label="Main" className="flex flex-col gap-2">
        <Link href="/report/new" className={linkClass}>
          Report an issue
        </Link>
        <Link href="/reports" className={linkClass}>
          My reports
        </Link>
        <Link href="/track" className={linkClass}>
          Track a report by its code
        </Link>
        <Link href="/sign-in" className={linkClass}>
          Sign in
        </Link>
      </nav>
    </main>
  );
}
