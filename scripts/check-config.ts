import { checkProductionConfig, isLaunchReady } from "../src/server/config-check";

/**
 * Command-line tool: checks the current settings (environment variables) for a real deployment.
 *
 *   pnpm check:config
 *
 * Run it in the same environment the site will run in, before switching the site on. It prints one
 * line per setting: PASS, WARN (worth reading, does not block) or FAIL (must be fixed), and exits
 * with an error code if anything failed, so a deployment pipeline can stop automatically.
 * It never prints the VALUE of a setting, only its name and what is wrong.
 */
const MARK = { pass: "PASS", warn: "WARN", fail: "FAIL" } as const;

const findings = checkProductionConfig(process.env);
for (const finding of findings) {
  console.log(`${MARK[finding.status]}  ${finding.setting.padEnd(22)} ${finding.message}`);
}

const failures = findings.filter((f) => f.status === "fail").length;
const warnings = findings.filter((f) => f.status === "warn").length;
console.log(`\n${failures} failure(s), ${warnings} warning(s).`);
if (!isLaunchReady(findings)) {
  console.log("NOT READY: fix the failures above before launch.");
  process.exitCode = 1;
} else {
  console.log("Configuration looks ready for launch.");
}
