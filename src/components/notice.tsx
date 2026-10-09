/**
 * A message box shown at the top of a page after the visitor did something ("Saved." or an error).
 *
 * - Successes use role="status" (screen readers announce them politely).
 * - Errors use role="alert" (announced immediately) and start with the word "Error:", so the
 *   message is clear even if the visitor cannot see colour.
 */
export function Notice({ notice }: { notice: { text: string; ok: boolean } | undefined }) {
  if (!notice) return null;
  return (
    <p role={notice.ok ? "status" : "alert"} className="rounded-md border border-current p-3">
      {notice.ok ? "" : "Error: "}
      {notice.text}
    </p>
  );
}
