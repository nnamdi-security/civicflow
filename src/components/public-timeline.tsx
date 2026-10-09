import { StatusBadge } from "@/components/status-badge";
import type { PublicReport } from "@/domain/reports/public-view";

const dateTimeFormat = new Intl.DateTimeFormat("en-NG", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Lagos",
});

/** Public timeline: status and time only. No notes and no names, by construction of `PublicReport`. */
export function PublicTimeline({ entries }: { entries: PublicReport["timeline"] }) {
  return (
    <ol className="flex flex-col gap-2">
      {entries.map((entry, index) => (
        <li key={`${entry.at.toISOString()}-${index}`} className="flex flex-wrap items-center gap-2 text-sm">
          <StatusBadge status={entry.status} />
          <time dateTime={entry.at.toISOString()}>{dateTimeFormat.format(entry.at)}</time>
        </li>
      ))}
    </ol>
  );
}
