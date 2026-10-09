import type { Metadata } from "next";
import { Button } from "@/components/button";
import { findReportAction } from "./actions";

export const metadata: Metadata = {
  title: "Track a report",
  robots: { index: false, follow: false },
};

export default async function TrackPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Track a report</h1>
      <p>Enter the reference code from your email or text message, for example CF-7K3M9QXD.</p>
      {error === "invalid" ? (
        <p role="alert" className="rounded-md border border-current p-3">
          Error: That does not look like a report reference. Check it and try again.
        </p>
      ) : null}
      <form action={findReportAction} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="font-medium">Reference code</span>
          <input
            name="reference"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={40}
            required
            className="min-h-11 rounded-md border border-current bg-transparent px-3 py-2"
          />
        </label>
        <Button type="submit" className="self-start">
          Find report
        </Button>
      </form>
      <p className="text-sm">Public pages show progress only: never who reported it, the description, photos or the exact spot.</p>
    </main>
  );
}
