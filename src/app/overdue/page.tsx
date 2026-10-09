import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { systemClock } from "@/domain/clock";
import { daysOverdue } from "@/domain/reports/public-view";
import { getDb } from "@/server/db";
import { listPubliclyOverdue } from "@/server/repositories/public-reports";
import { overdueBoardEnabled } from "@/server/reports/public-deps";

export const metadata: Metadata = { title: "Overdue reports" };

const dateFormat = new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeZone: "Africa/Lagos" });

export default async function OverdueBoardPage() {
  // Read the switch and the list per request: never prerender them at build time.
  await connection();
  // Off until real SLA values are agreed (ADR 0013): the page does not exist as far as visitors can tell.
  if (!overdueBoardEnabled()) notFound();

  const items = await listPubliclyOverdue(getDb());
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">Overdue reports</h1>
      <p>Reports an agency has not dealt with in time, longest overdue first.</p>
      {items.length === 0 ? (
        <p>No reports are marked publicly overdue.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.reference} className="rounded-md border border-current p-3">
              <a href={`/track/${item.reference}`} className="font-medium underline">
                {item.reference}: {item.categoryName}
              </a>
              <p className="mt-1">
                {item.agencyName ?? "No agency assigned"} · {item.areaName ?? "Area not recorded"}
              </p>
              <p className="mt-1 text-sm">
                Overdue by {daysOverdue(item.overdueSince, systemClock)} day(s), since{" "}
                <time dateTime={item.overdueSince.toISOString()}>{dateFormat.format(item.overdueSince)}</time>
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
