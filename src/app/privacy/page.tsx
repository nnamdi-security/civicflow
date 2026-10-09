/**
 * The privacy notice: /privacy.
 *
 * The facts here (what is collected, who sees it, how long it is kept) describe what the software
 * actually does, and match docs/security-privacy.md and ADRs 0011 to 0015. The LEGAL parts (who the
 * organisation is, the legal basis, transfers abroad, the regulator's details) are marked
 * [PLACEHOLDER] because only the operator and their adviser can supply them. Whoever completes
 * this page should keep the facts in step with the code if either changes.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { DraftBanner } from "@/components/draft-banner";

export const metadata: Metadata = { title: "Privacy notice" };

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-6">
      <Link href="/" className="underline focus-visible:outline-2 focus-visible:outline-offset-2">Home</Link>
      <h1 className="text-2xl font-semibold">Privacy notice</h1>
      <DraftBanner what="privacy notice" />

      <h2 className="text-lg font-semibold">Who we are</h2>
      <p>
        CivicFlow is a service that lets residents report problems with public infrastructure and follow how the
        responsible agency responds. [PLACEHOLDER: the legal name of the organisation that runs CivicFlow, its address,
        and a contact email for privacy questions.]
      </p>

      <h2 className="text-lg font-semibold">What we collect</h2>
      <ul className="list-disc pl-6">
        <li><strong>Your email address</strong>, to sign you in (there are no passwords) and to send you updates about your reports. We do not ask for your name.</li>
        <li><strong>A phone number, only if you add and confirm one</strong>, to send you text messages about your reports. You can remove it at any time.</li>
        <li><strong>Your reports</strong>: the kind of problem, your description, the exact place you mark on the map, and one to three photos. Please do not photograph people&rsquo;s faces or vehicle number plates.</li>
        <li><strong>Records of messages we sent you</strong> (which message, when, and whether it was delivered), but not the text of the messages.</li>
        <li><strong>Technical data</strong>: a sign-in cookie that keeps you signed in, and a scrambled (hashed) form of your network address, used only to slow down abuse. We do not use advertising or tracking cookies.</li>
      </ul>

      <h2 className="text-lg font-semibold">Why we use it</h2>
      <p>
        To send your report to the right agency, to track the agency&rsquo;s response against its deadlines, to tell you
        what is happening, and to keep the service secure. [PLACEHOLDER: the legal basis for each use under the Nigeria
        Data Protection Act, to be confirmed by a data-protection adviser.]
      </p>

      <h2 className="text-lg font-semibold">Who can see what</h2>
      <ul className="list-disc pl-6">
        <li><strong>Anyone</strong> who knows a report&rsquo;s reference code can see its category, status, the agency handling it, the area (local government area or state) and the timeline. They cannot see who reported it, your description, your photos, or the exact location.</li>
        <li><strong>Staff of the agency handling your report</strong> can see the description, photos and exact location so they can fix the problem. Their screens do not show your name or email address.</li>
        <li><strong>CivicFlow administrators</strong> can manage agencies and accounts. Administrative changes are recorded in an audit log that contains no personal data.</li>
      </ul>

      <h2 className="text-lg font-semibold">Companies that help us run the service</h2>
      <ul className="list-disc pl-6">
        <li>An email delivery provider (Resend), to send sign-in links and updates.</li>
        <li>A text-message provider (Termii), to send texts, if you choose to receive them.</li>
        <li>A photo hosting provider (Cloudinary), to store your photos.</li>
        <li>OpenStreetMap, which provides the map pictures. Your browser asks OpenStreetMap for them, so it can see your network address.</li>
        <li>[PLACEHOLDER: the hosting provider and the country where data is stored.]</li>
      </ul>
      <p>[PLACEHOLDER: statement about transfers of personal data outside Nigeria and the safeguards used, to be confirmed by a data-protection adviser.]</p>

      <h2 className="text-lg font-semibold">How long we keep it</h2>
      <p>These periods are provisional and will be confirmed before launch.</p>
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">How long each kind of data is kept</caption>
        <thead>
          <tr>
            <th scope="col" className="border border-current p-2">Data</th>
            <th scope="col" className="border border-current p-2">Kept for</th>
          </tr>
        </thead>
        <tbody>
          <tr><th scope="row" className="border border-current p-2 font-normal">Your account (email, phone)</th><td className="border border-current p-2">Until you delete your account</td></tr>
          <tr><th scope="row" className="border border-current p-2 font-normal">Your reports and their history</th><td className="border border-current p-2">Kept as a public accountability record. When you delete your account, your description, photos and exact location are removed and the rest is kept without your details</td></tr>
          <tr><th scope="row" className="border border-current p-2 font-normal">Records of messages sent to you</th><td className="border border-current p-2">90 days (180 days if delivery failed)</td></tr>
          <tr><th scope="row" className="border border-current p-2 font-normal">Anti-abuse counters</th><td className="border border-current p-2">7 days</td></tr>
          <tr><th scope="row" className="border border-current p-2 font-normal">Backups</th><td className="border border-current p-2">[PLACEHOLDER: backup retention period]</td></tr>
        </tbody>
      </table>

      <h2 className="text-lg font-semibold">Your rights</h2>
      <ul className="list-disc pl-6">
        <li><strong>See your data:</strong> sign in and use &ldquo;Download my data&rdquo; on your <Link href="/account" className="underline">account page</Link>.</li>
        <li><strong>Delete your data:</strong> use &ldquo;Delete my account&rdquo; on the same page.</li>
        <li><strong>Stop messages:</strong> switch off email or text updates, or remove your phone number, on the same page.</li>
        <li><strong>Correct, object or complain:</strong> [PLACEHOLDER: how to contact us, and the details of the Nigeria Data Protection Commission for complaints].</li>
      </ul>

      <h2 className="text-lg font-semibold">Changes to this notice</h2>
      <p>[PLACEHOLDER: how and when we will tell you about changes.] Last updated: [PLACEHOLDER: date].</p>
    </main>
  );
}
