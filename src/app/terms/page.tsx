/**
 * The terms of use: /terms. A DRAFT: plain-language rules that describe how the service is meant
 * to be used. Everything legal (the organisation, governing law, liability wording) is a
 * [PLACEHOLDER] for the operator's lawyer to complete.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { DraftBanner } from "@/components/draft-banner";

export const metadata: Metadata = { title: "Terms of use" };

export default function TermsPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-6">
      <Link href="/" className="underline focus-visible:outline-2 focus-visible:outline-offset-2">Home</Link>
      <h1 className="text-2xl font-semibold">Terms of use</h1>
      <DraftBanner what="set of terms" />

      <h2 className="text-lg font-semibold">What CivicFlow is</h2>
      <p>
        CivicFlow helps residents report problems with public infrastructure and follow the response. It is run by
        [PLACEHOLDER: the organisation]. It is <strong>not an emergency service</strong>. If anyone is in danger, contact
        the emergency services directly [PLACEHOLDER: confirm the emergency numbers to show here].
      </p>

      <h2 className="text-lg font-semibold">Using it properly</h2>
      <ul className="list-disc pl-6">
        <li>Report real problems, truthfully, and only once. Do not send false, abusive or duplicate reports.</li>
        <li>Do not include other people&rsquo;s personal details (names, phone numbers, faces, number plates) in descriptions or photos.</li>
        <li>Do not try to break, overload or get around the security of the service, or to read other people&rsquo;s data.</li>
        <li>Keep your sign-in links private. Anyone who has one can use your account.</li>
      </ul>

      <h2 className="text-lg font-semibold">What happens to your reports</h2>
      <p>
        When you send a report, you agree that we may share it with the agency responsible and publish its category,
        status, handling agency, area and timeline, as described in the <Link href="/privacy" className="underline">privacy notice</Link>.
        Your description, photos, exact location and identity are not published.
      </p>

      <h2 className="text-lg font-semibold">What we promise, and what we cannot</h2>
      <p>
        We pass reports to agencies, track their response and show you the result. Agencies decide whether and how to
        act. Deadlines shown on CivicFlow are targets used to measure the response, not a guarantee that a problem will
        be fixed by that date. [PLACEHOLDER: limits of liability and availability wording.]
      </p>

      <h2 className="text-lg font-semibold">Suspending accounts</h2>
      <p>We may suspend an account that breaks these rules. [PLACEHOLDER: process for appeals.]</p>

      <h2 className="text-lg font-semibold">Changes and governing law</h2>
      <p>[PLACEHOLDER: how changes are announced, and which country&rsquo;s law applies.] Last updated: [PLACEHOLDER: date].</p>
    </main>
  );
}
