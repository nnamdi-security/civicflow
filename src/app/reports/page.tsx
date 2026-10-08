import Link from "next/link";
import { redirect } from "next/navigation";
import { StatusBadge } from "@/components/status-badge";
import { getActor } from "@/server/auth/guards";
import { getDb } from "@/server/db";
import { listReportsForReporter } from "@/server/repositories/reports";

const dateFormat = new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeZone: "Africa/Lagos" });

export default async function MyReportsPage() {
  const actor = await getActor();
  if (!actor) redirect("/sign-in?next=%2Freports");

  const reports = await listReportsForReporter(getDb(), actor.userId);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">My reports</h1>
      <Link href="/report/new" className="underline focus-visible:outline-2 focus-visible:outline-offset-2">
        Report a new issue
      </Link>
      {reports.length === 0 ? (
        <p>You have not reported anything yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {reports.map((report) => (
            <li key={report.id} className="rounded-md border border-current p-3">
              <Link
                href={`/reports/${report.id}`}
                className="font-medium underline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {report.reference}: {report.categoryName}
              </Link>
              <p className="mt-1 line-clamp-2">{report.description}</p>
              <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <StatusBadge status={report.status} />
                <span>Sent {dateFormat.format(report.createdAt)}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
