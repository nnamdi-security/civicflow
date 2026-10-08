import { readFile } from "node:fs/promises";
import path from "node:path";

// Local development helper: prints the newest SMS in .dev-outbox/ (to your own terminal only).
async function main() {
  const file = path.join(process.cwd(), ".dev-outbox", "sms.jsonl");
  const lines = (await readFile(file, "utf8").catch(() => "")).trim().split("\n").filter(Boolean);
  const last = lines.at(-1);
  if (!last) {
    console.log("No SMS in .dev-outbox/ yet.");
    return;
  }
  const { at, to, text } = JSON.parse(last) as Record<string, string>;
  console.log(`${at}\nTo: ${to}\n\n${text}`);
}

void main();
