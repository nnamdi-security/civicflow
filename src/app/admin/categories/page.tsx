/**
 * Report categories: /admin/categories. Platform admins only.
 *
 * Switching a category OFF hides it from the report form so residents can no longer choose it.
 * Reports already filed under it are not affected. At least one category must stay on.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/button";
import { Notice } from "@/components/notice";
import { getDb } from "@/server/db";
import { listCategories } from "@/server/repositories/admin";
import { setCategoryActiveAction } from "../actions";
import { requirePlatformAdminPage } from "../guard";
import { noticeFor } from "../messages";

export const metadata: Metadata = { title: "Report categories", robots: { index: false, follow: false } };

export default async function CategoriesPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams;
  await requirePlatformAdminPage("/admin/categories");
  const categories = await listCategories(getDb());

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 p-6">
      <Link href="/admin" className="underline focus-visible:outline-2 focus-visible:outline-offset-2">Administration</Link>
      <h1 className="text-2xl font-semibold">Report categories</h1>
      <Notice notice={noticeFor(notice)} />
      <ul className="flex flex-col gap-2">
        {categories.map((category) => (
          <li key={category.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-current p-3">
            <span>
              <span className="font-medium">{category.name}</span>
              {/* State is written as a word, never only shown by colour. */}
              <span className="ml-2 text-sm">{category.active ? "On" : "Off"}</span>
            </span>
            <form action={setCategoryActiveAction}>
              <input type="hidden" name="categoryId" value={category.id} />
              {/* The button's value tells the server which state to switch TO. */}
              <Button type="submit" name="state" value={category.active ? "off" : "on"}>
                {category.active ? `Switch off ${category.name}` : `Switch on ${category.name}`}
              </Button>
            </form>
          </li>
        ))}
      </ul>
    </main>
  );
}
