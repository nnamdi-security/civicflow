/**
 * A prominent notice shown at the top of the privacy notice and terms of use while their wording
 * is still a DRAFT. Remove it from a page only after a qualified person (a lawyer or data-protection
 * adviser) has reviewed and approved that page's text, and replaced every [PLACEHOLDER].
 *
 * It is written in words, with a visible border, so it does not depend on colour to be noticed.
 */
export function DraftBanner({ what }: { what: string }) {
  return (
    <p role="note" className="rounded-md border-2 border-current p-3 font-medium">
      DRAFT FOR LEGAL REVIEW. This {what} describes how CivicFlow actually works, but it has not yet been reviewed by a
      lawyer or data-protection adviser, is not legal advice, and still contains [PLACEHOLDER] items to complete.
    </p>
  );
}
