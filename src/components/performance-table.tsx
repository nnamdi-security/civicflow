/**
 * The table of performance figures shown on the dashboard page (ADR 0014).
 *
 * This is a "server component": it runs on the server and just turns data into HTML. It has no
 * buttons or state of its own, which keeps the page fast on slow connections.
 *
 * Accessibility notes, so the table works for everyone:
 *   - it is a real <table> with a <caption> and header cells marked `scope`, so screen readers
 *     can announce which column and row each number belongs to;
 *   - nothing relies on colour alone: warnings such as "small sample" and "overdue" are written
 *     out in words;
 *   - on a narrow phone screen the table scrolls sideways inside its own box instead of
 *     stretching the whole page.
 */
import { formatDuration, type AgencyPerformance, type TimerSummary } from "@/domain/performance";

/** "80% (8 of 10)" or "No data". Adds "small sample" when there are too few to trust the percentage. */
function onTimeText(summary: TimerSummary): string {
  if (summary.onTimePercent === null) return "No data";
  const text = `${summary.onTimePercent}% (${summary.met} of ${summary.total})`;
  return summary.lowSample ? `${text}, small sample` : text;
}

export function PerformanceTable({ agencies, days }: { agencies: AgencyPerformance[]; days: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="mb-2 text-left font-medium">Agency performance, last {days} days</caption>
        <thead>
          <tr>
            {/* One header cell per column. `scope="col"` tells assistive technology "this labels the column below". */}
            <th scope="col" className="border border-current p-2">Agency</th>
            <th scope="col" className="border border-current p-2">Acknowledged on time</th>
            <th scope="col" className="border border-current p-2">Median time to acknowledge</th>
            <th scope="col" className="border border-current p-2">Resolved on time</th>
            <th scope="col" className="border border-current p-2">Median time to resolve</th>
            <th scope="col" className="border border-current p-2">Open reports</th>
            <th scope="col" className="border border-current p-2">Overdue now</th>
            <th scope="col" className="border border-current p-2">Disputed after resolving</th>
          </tr>
        </thead>
        <tbody>
          {agencies.map((agency) => (
            <tr key={agency.agencyId}>
              {/* The first cell of each row is a header for that row (`scope="row"`). */}
              <th scope="row" className="border border-current p-2 font-medium">{agency.agencyName}</th>
              <td className="border border-current p-2">{onTimeText(agency.acknowledge)}</td>
              <td className="border border-current p-2">{formatDuration(agency.acknowledge.medianMinutes)}</td>
              <td className="border border-current p-2">{onTimeText(agency.resolve)}</td>
              <td className="border border-current p-2">{formatDuration(agency.resolve.medianMinutes)}</td>
              <td className="border border-current p-2">{agency.openReports}</td>
              <td className="border border-current p-2">
                {/* Written out in words so the warning does not depend on colour. */}
                {agency.openOverdue > 0 ? `${agency.openOverdue} overdue` : "None overdue"}
              </td>
              <td className="border border-current p-2">
                {agency.disputeRatePercent === null
                  ? "No data"
                  : `${agency.disputeRatePercent}% (${agency.disputes} of ${agency.resolutions})`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
