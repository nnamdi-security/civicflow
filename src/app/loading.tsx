/**
 * Shown while a page is being prepared on the server (Next.js displays it automatically between
 * clicking a link and the new page arriving). On a slow connection this tells the visitor that
 * something is happening instead of leaving a frozen screen. `role="status"` makes screen
 * readers announce it politely.
 */
export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center p-6">
      <p role="status">Loading…</p>
    </main>
  );
}
