/**
 * Checks that the settings (environment variables) are right for a REAL deployment, before the
 * site is switched on (Phase 8 Part B, docs/launch-checklist.md).
 *
 * Why: most failed launches are not bugs in the code but a missing or wrong setting: an email key
 * left empty so sign-in links are never sent, a database password still set to the development
 * default, a site address that still says "localhost" so every link in every email is broken.
 * This turns those mistakes into a clear list that can be checked in seconds.
 *
 * It is PURE: it takes the settings as a plain object and returns findings. It never prints or
 * returns a secret's VALUE; messages name the setting only. The command `pnpm check:config`
 * (scripts/check-config.ts) runs it against the real environment.
 */

export type CheckStatus = "pass" | "fail" | "warn";

export interface ConfigFinding {
  /** The setting this is about, for example "AUTH_SECRET". */
  setting: string;
  status: CheckStatus;
  /** A short sentence a non-expert can act on. Never contains the setting's value. */
  message: string;
}

type Env = Record<string, string | undefined>;

/** Reads a setting, treating a blank value (`KEY=`) as not set, as the app itself does. */
function read(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

const pass = (setting: string, message: string): ConfigFinding => ({ setting, status: "pass", message });
const fail = (setting: string, message: string): ConfigFinding => ({ setting, status: "fail", message });
const warn = (setting: string, message: string): ConfigFinding => ({ setting, status: "warn", message });

/** True for addresses that only work on the developer's own computer. */
function pointsAtThisComputer(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]" || host.endsWith(".local");
  } catch {
    return false;
  }
}

/** A secret made of one repeated character, or an obvious placeholder, is not a real secret. */
function looksLikePlaceholder(value: string): boolean {
  if (new Set(value).size <= 3) return true;
  return /^(changeme|change-me|secret|password|example|test|todo|xxx+|your[-_ ]?secret)/i.test(value);
}

export function checkProductionConfig(env: Env): ConfigFinding[] {
  const findings: ConfigFinding[] = [];

  // ---- Mode ------------------------------------------------------------------------------
  if (read(env, "NODE_ENV") === "production") {
    findings.push(pass("NODE_ENV", "Set to production."));
  } else {
    findings.push(fail("NODE_ENV", "Must be \"production\" for a real deployment (development mode is slower and less safe)."));
  }

  // ---- Database --------------------------------------------------------------------------
  const database = read(env, "DATABASE_URL");
  if (!database) {
    findings.push(fail("DATABASE_URL", "Not set."));
  } else if (/civicflow_dev_only/.test(database)) {
    findings.push(fail("DATABASE_URL", "Still uses the development password. Use a strong, unique database password."));
  } else if (pointsAtThisComputer(database.replace(/^postgres(ql)?:/, "http:"))) {
    findings.push(fail("DATABASE_URL", "Points at this computer (localhost). A real deployment needs the managed database's address."));
  } else {
    findings.push(pass("DATABASE_URL", "Set, not the development default, not localhost."));
  }

  // ---- Secret used to sign sessions and hash codes ----------------------------------------
  const secret = read(env, "AUTH_SECRET");
  if (!secret) {
    findings.push(fail("AUTH_SECRET", "Not set. Generate one with: openssl rand -base64 32"));
  } else if (secret.length < 32) {
    findings.push(fail("AUTH_SECRET", "Too short: it must be at least 32 characters."));
  } else if (looksLikePlaceholder(secret)) {
    findings.push(fail("AUTH_SECRET", "Looks like a placeholder, not a random secret. Generate one with: openssl rand -base64 32"));
  } else {
    findings.push(pass("AUTH_SECRET", "Set, long enough, and not an obvious placeholder."));
  }

  // ---- Public address (used in every link in every email and text) ------------------------
  const siteUrl = read(env, "AUTH_URL");
  if (!siteUrl) {
    findings.push(fail("AUTH_URL", "Not set. It is the public address of the site, used in every link in emails and texts."));
  } else {
    let parsed: URL | null = null;
    try {
      parsed = new URL(siteUrl);
    } catch {
      parsed = null;
    }
    if (!parsed) findings.push(fail("AUTH_URL", "Not a valid web address (it should look like https://your-domain)."));
    else if (parsed.protocol !== "https:") findings.push(fail("AUTH_URL", "Must start with https:// in production."));
    else if (pointsAtThisComputer(siteUrl)) findings.push(fail("AUTH_URL", "Points at this computer (localhost): every emailed link would be broken."));
    else findings.push(pass("AUTH_URL", "A valid https address."));
  }

  // ---- Email -------------------------------------------------------------------------------
  const resendKey = read(env, "RESEND_API_KEY");
  const emailFrom = read(env, "EMAIL_FROM");
  if (!resendKey) findings.push(fail("RESEND_API_KEY", "Not set. Sign-in links and report updates cannot be emailed."));
  else findings.push(pass("RESEND_API_KEY", "Set."));
  if (!emailFrom) findings.push(fail("EMAIL_FROM", "Not set. Use an address on a domain you have verified with Resend."));
  else if (!/@/.test(emailFrom)) findings.push(fail("EMAIL_FROM", "Does not look like an email address."));
  else findings.push(pass("EMAIL_FROM", "Set."));

  // ---- Photos ------------------------------------------------------------------------------
  const cloudinary = ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"].map((name) => [name, read(env, name)] as const);
  const missing = cloudinary.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length === 0) {
    findings.push(pass("CLOUDINARY_*", "All three Cloudinary settings are set."));
  } else {
    findings.push(fail("CLOUDINARY_*", `Missing: ${missing.join(", ")}. Photos cannot be stored in production without all three.`));
  }

  // ---- SMS (optional) ----------------------------------------------------------------------
  const termiiKey = read(env, "TERMII_API_KEY");
  const termiiSender = read(env, "TERMII_SENDER_ID");
  if (termiiKey && termiiSender) {
    findings.push(pass("TERMII_*", "SMS is configured."));
  } else if (!termiiKey && !termiiSender) {
    findings.push(warn("TERMII_*", "SMS is not configured: texts will not be sent and phone verification will be unavailable. Email still works."));
  } else {
    findings.push(fail("TERMII_*", "Set both TERMII_API_KEY and TERMII_SENDER_ID, or neither."));
  }

  // ---- Trusted proxies (decides whose network address the rate limits see) ----------------------
  const hops = read(env, "TRUSTED_PROXY_HOPS");
  if (hops === undefined) {
    findings.push(
      warn(
        "TRUSTED_PROXY_HOPS",
        "Not set: assuming exactly ONE trusted proxy in front of the app. Set it to the real number, or visitors' addresses (used by the rate limits) will be wrong.",
      ),
    );
  } else if (!/^[0-5]$/.test(hops)) {
    findings.push(fail("TRUSTED_PROXY_HOPS", "Must be a whole number from 0 to 5."));
  } else if (hops === "0") {
    findings.push(warn("TRUSTED_PROXY_HOPS", "0: network-address headers are ignored, so every visitor shares ONE rate-limit bucket."));
  } else {
    findings.push(pass("TRUSTED_PROXY_HOPS", `Set to ${hops}. Make sure this matches the real number of proxies in front of the app.`));
  }

  // ---- Public overdue board ------------------------------------------------------------------
  const board = read(env, "PUBLIC_OVERDUE_BOARD");
  if (board === "true") {
    findings.push(warn("PUBLIC_OVERDUE_BOARD", "ON: agencies are named publicly as overdue. Only leave this on once real SLA targets are agreed."));
  } else if (board === undefined || board === "false") {
    findings.push(pass("PUBLIC_OVERDUE_BOARD", "Off (the safe default)."));
  } else {
    findings.push(fail("PUBLIC_OVERDUE_BOARD", "Must be \"true\" or \"false\"."));
  }

  return findings;
}

/** True when no finding is a failure. Warnings do not block a launch, but should be read. */
export function isLaunchReady(findings: readonly ConfigFinding[]): boolean {
  return findings.every((finding) => finding.status !== "fail");
}
