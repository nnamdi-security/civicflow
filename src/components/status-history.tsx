import { StatusBadge } from "@/components/status-badge";
import type { StatusHistoryEntry } from "@/server/repositories/report-workflow";

const dateTimeFormat = new Intl.DateTimeFormat("en-NG", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Lagos",
});

/** Oldest first. Shows what happened and when, never who did it. */
export function StatusHistory({ entries }: { entries: StatusHistoryEntry[] }) {
  return (
    <ol className="flex flex-col gap-2">
      {entries.map((entry, index) => (
        <li key={`${entry.createdAt.toISOString()}-${index}`} className="flex flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2 text-sm">
            <StatusBadge status={entry.toStatus} />
            <time dateTime={entry.createdAt.toISOString()}>{dateTimeFormat.format(entry.createdAt)}</time>
          </span>
          {entry.reason ? <span className="whitespace-pre-wrap text-sm">Note: {entry.reason}</span> : null}
        </li>
      ))}
    </ol>
  );
}
