import { ESCALATION_LADDER, type EscalationLevel, type SlaTimer } from "@/domain/sla";

interface SlaNoticeProps {
  /** Timers past their deadline right now (`overdueTimers`). */
  overdue: SlaTimer[];
  ackLevel: number | null;
  resolveLevel: number | null;
  audience: "staff" | "resident";
}

const TIMER_NAME: Record<SlaTimer, string> = { acknowledge: "acknowledgement", resolve: "resolution" };
const TARGET_NAME: Record<string, string> = {
  agency_admin: "agency admin",
  platform_admin: "platform admin",
  public_overdue: "publicly marked overdue",
};

function levelText(level: number | null) {
  if (level === null || !(level in ESCALATION_LADDER)) return null;
  return TARGET_NAME[ESCALATION_LADDER[level as EscalationLevel].target] ?? null;
}

/** Text-only overdue notice; never relies on colour. Renders nothing when nothing is overdue. */
export function SlaNotice({ overdue, ackLevel, resolveLevel, audience }: SlaNoticeProps) {
  if (overdue.length === 0) return null;
  const level = { acknowledge: ackLevel, resolve: resolveLevel } as const;

  return (
    <ul className="flex flex-col gap-1">
      {overdue.map((timer) => (
        <li key={timer} className="rounded-md border border-current p-2 text-sm font-medium">
          {audience === "staff" ? (
            <>
              Overdue: {TIMER_NAME[timer]}
              {levelText(level[timer]) ? ` (escalated: ${levelText(level[timer])})` : ""}
            </>
          ) : timer === "acknowledge" ? (
            <>Overdue: the agency has not yet acknowledged this report.</>
          ) : (
            <>Overdue: the agency has not yet resolved this report.</>
          )}
          {audience === "resident" && level[timer] === 3 ? " It has been marked publicly overdue." : ""}
        </li>
      ))}
    </ul>
  );
}
