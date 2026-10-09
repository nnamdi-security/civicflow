/**
 * Performance dashboard page: /agency/performance
 *
 *   - An agency admin sees how THEIR agency is doing.
 *   - A platform admin sees every agency side by side.
 *   - Officers, residents and signed-out visitors cannot see it.
 *
 * Reading this file top to bottom: (1) find out who is asking, (2) ask the "use case" for the
 * figures (it does the permission check), (3) show them. The page itself never decides who may
 * see what; that lives in the use case and the database query (ADR 0014).
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PerformanceTable } from "@/components/performance-table";
import { systemClock } from "@/domain/clock";
import { PERFORMANCE_WINDOWS } from "@/domain/performance";
import { ForbiddenError } from "@/server/auth/errors";
import { getActor } from "@/server/auth/guards";
import { getDb } from "@/server/db";
import { getPerformanceDashboard } from "@/server/performance/dashboard";

// Management figures: keep them out of search engines.
export const metadata: Metadata = { title: "Agency performance", robots: { index: false, follow: false } };

const dateFormat = new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeZone: "Africa/Lagos" });

export default async function PerformancePage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  // `searchParams` holds the part of the web address after "?", for example ?days=90.
  const { days } = await searchParams;

  // 1. Who is asking? Visitors who are not signed in are sent to sign in, then brought back here.
  const actor = await getActor();
  if (!actor) redirect("/sign-in?next=%2Fagency%2Fperformance");

  // 2. Ask for the figures. The use case refuses people who may not see them.
  let dashboard;
  try {
    dashboard = await getPerformanceDashboard({ db: getDb(), clock: systemClock }, actor, days);
  } catch (error) {
    // Show "not found" rather than "forbidden": this page does not reveal that it exists to people who cannot use it.
    if (error instanceof ForbiddenError) notFound();
    throw error; // anything else is a real problem; let Next.js show its error page
  }

  const isPlatformView = actor.role === "platform_admin";

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-6">
      <Link href="/agency" className="underline focus-visible:outline-2 focus-visible:outline-offset-2">
        Back to reports
      </Link>
      <h1 className="text-2xl font-semibold">
        {isPlatformView ? "Agency performance" : "Your agency's performance"}
      </h1>

      {/* Switch between the two time windows. `aria-current` tells screen readers which one is showing. */}
      <nav aria-label="Time window" className="flex gap-4">
        {PERFORMANCE_WINDOWS.map((option) => (
          <Link
            key={option}
            href={`/agency/performance?days=${option}`}
            aria-current={option === dashboard.days ? "page" : undefined}
            className={`underline focus-visible:outline-2 focus-visible:outline-offset-2 ${
              option === dashboard.days ? "font-semibold" : ""
            }`}
          >
            Last {option} days
          </Link>
        ))}
      </nav>

      {/* Honest context, so the numbers are not misread. */}
      <p className="text-sm">
        {dashboard.recordsSince
          ? `Records begin ${dateFormat.format(dashboard.recordsSince)}; earlier reports are not included.`
          : "No performance records yet. Figures appear after agencies acknowledge or resolve reports."}{" "}
        Deadlines are provisional until official targets are agreed, so treat the percentages as a guide.
      </p>

      {dashboard.agencies.length === 0 ? (
        <p>There are no agencies to show.</p>
      ) : (
        <PerformanceTable agencies={dashboard.agencies} days={dashboard.days} />
      )}

      <p className="text-sm">
        &ldquo;On time&rdquo; counts finishing at or before the deadline. Reports that were rejected or moved to another
        agency are not counted for or against an agency. Disputes are counted against the agency now holding the
        report.
      </p>
    </main>
  );
}
