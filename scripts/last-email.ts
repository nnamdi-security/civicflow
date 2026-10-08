import { readFile } from "node:fs/promises";
import path from "node:path";

// Local development helper: prints the newest message in .dev-outbox/ (to your own terminal only).
async function main() {
  const file = path.join(process.cwd(), ".dev-outbox", "emails.jsonl");
  const lines = (await readFile(file, "utf8").catch(() => "")).trim().split("\n").filter(Boolean);
  const last = lines.at(-1);
  if (!last) {
    console.log("No emails in .dev-outbox/ yet.");
    return;
  }
  const { at, to, subject, text } = JSON.parse(last) as Record<string, string>;
  console.log(`${at}\nTo: ${to}\nSubject: ${subject}\n\n${text}`);
}

void main();
