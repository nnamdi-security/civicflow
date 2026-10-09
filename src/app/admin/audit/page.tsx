/**
 * The audit log: /admin/audit. Platform admins only.
 *
 * A read-only list of the most recent administrative changes: when, who (email and role) and
 * what. The log itself can never be edited or deleted (a database trigger forbids it), and it
 * stores no personal data in the "what" sentence (ADR 0014).
 */
import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/server/db";
import { listRecentAudit } from "@/server/repositories/audit";
import { requirePlatformAdminPage } from "../guard";

export const metadata: Metadata = { title: "Audit log", robots: { index: false, follow: false } };

const dateTimeFormat = new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" });

export default async function AuditPage() {
  await requirePlatformAdminPage("/admin/audit");
  const rows = await listRecentAudit(getDb());

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 p-6">
      <Link href="/admin" className="underline focus-visible:outline-2 focus-visible:outline-offset-2">Administration</Link>
      <h1 className="text-2xl font-semibold">Audit log</h1>
      <p className="text-sm">The 100 most recent administrative changes, newest first. This record cannot be edited.</p>
      {rows.length === 0 ? (
        <p>No administrative changes have been recorded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">Recent administrative changes</caption>
            <thead>
              <tr>
                <th scope="col" className="border border-current p-2">When</th>
                <th scope="col" className="border border-current p-2">Who</th>
                <th scope="col" className="border border-current p-2">Change</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="border border-current p-2">
                    <time dateTime={row.createdAt.toISOString()}>{dateTimeFormat.format(row.createdAt)}</time>
                  </td>
                  <td className="border border-current p-2">{row.actorEmail} ({row.actorRole})</td>
                  <td className="border border-current p-2">
                    <span className="font-medium">{row.action}</span>: {row.summary}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
