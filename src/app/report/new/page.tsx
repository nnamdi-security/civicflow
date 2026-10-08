import { redirect } from "next/navigation";
import { getActor } from "@/server/auth/guards";
import { getDb } from "@/server/db";
import { listActiveCategories } from "@/server/repositories/reports";
import { ReportForm } from "./report-form";

export default async function NewReportPage() {
  if (!(await getActor())) redirect("/sign-in?next=%2Freport%2Fnew");

  const categories = await listActiveCategories(getDb());

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">Report an issue</h1>
      <p>Tell us what is wrong and where. A photo is required so the agency can see the problem.</p>
      <ReportForm categories={categories} />
    </main>
  );
}
