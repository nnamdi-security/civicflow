/**
 * Admin home: /admin. A simple menu of the platform-admin screens. Platform admins only.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { requirePlatformAdminPage } from "./guard";

export const metadata: Metadata = { title: "Administration", robots: { index: false, follow: false } };

const linkClass = "underline focus-visible:outline-2 focus-visible:outline-offset-2";

export default async function AdminHomePage() {
  await requirePlatformAdminPage("/admin");
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">Administration</h1>
      <nav aria-label="Administration" className="flex flex-col gap-2">
        <Link href="/admin/agencies" className={linkClass}>Agencies and the areas they cover</Link>
        <Link href="/agency/staff" className={linkClass}>Staff accounts</Link>
        <Link href="/admin/sla" className={linkClass}>SLA deadlines</Link>
        <Link href="/admin/categories" className={linkClass}>Report categories</Link>
        <Link href="/admin/triage" className={linkClass}>Unrouted reports (triage)</Link>
        <Link href="/agency/performance" className={linkClass}>Agency performance</Link>
        <Link href="/admin/audit" className={linkClass}>Audit log</Link>
        <Link href="/admin/health" className={linkClass}>System health</Link>
      </nav>
    </main>
  );
}
