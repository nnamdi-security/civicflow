/**
 * Agencies list and "create agency" form: /admin/agencies. Platform admins only.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/button";
import { Notice } from "@/components/notice";
import { AGENCY_TYPES } from "@/domain/agency-types";
import { getDb } from "@/server/db";
import { listAgencies } from "@/server/repositories/admin";
import { createAgencyAction } from "../actions";
import { requirePlatformAdminPage } from "../guard";
import { noticeFor } from "../messages";

export const metadata: Metadata = { title: "Agencies", robots: { index: false, follow: false } };

// Shared look for text boxes, so every form on the admin screens matches.
const fieldClass = "min-h-11 rounded-md border border-current bg-transparent px-3 py-2";

export default async function AgenciesPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams;
  await requirePlatformAdminPage("/admin/agencies");
  const agencies = await listAgencies(getDb());

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-6">
      <Link href="/admin" className="underline focus-visible:outline-2 focus-visible:outline-offset-2">Administration</Link>
      <h1 className="text-2xl font-semibold">Agencies</h1>
      <Notice notice={noticeFor(notice)} />

      {agencies.length === 0 ? (
        <p>There are no agencies yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {agencies.map((agency) => (
            <li key={agency.id} className="rounded-md border border-current p-3">
              <Link href={`/admin/agencies/${agency.id}`} className="font-medium underline">{agency.name}</Link>
              <p className="text-sm">
                Type: {agency.type} · Covers {agency.coverageCount} area{agency.coverageCount === 1 ? "" : "s"}
              </p>
            </li>
          ))}
        </ul>
      )}

      <form action={createAgencyAction} className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Create an agency</h2>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Name</span>
          <input name="name" required minLength={2} maxLength={100} className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Type (the kind of problem it handles)</span>
          <select name="type" required defaultValue="" className={fieldClass}>
            <option value="" disabled>Choose a type</option>
            {AGENCY_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </label>
        <Button type="submit" className="self-start">Create agency</Button>
      </form>
    </main>
  );
}
