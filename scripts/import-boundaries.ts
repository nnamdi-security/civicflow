import { readFile } from "node:fs/promises";
import { createDb } from "../src/db/client";
import { importBoundaryFile } from "../src/server/boundaries/import";

/**
 * Command-line tool: loads state or LGA boundaries from a GeoJSON file.
 *
 *   pnpm boundaries:import <file.geojson> --level state|lga --name-field <property>
 *                          [--parent-field <property>] [--dry-run] [--yes]
 *
 * Typical use, in two passes (states first, then LGAs):
 *   pnpm boundaries:import states.geojson --level state --name-field admin1Name --dry-run
 *   pnpm boundaries:import states.geojson --level state --name-field admin1Name
 *   pnpm boundaries:import lgas.geojson   --level lga   --name-field admin2Name --parent-field admin1Name
 *
 *   --level         what kind of place the features are ("state" or "lga").
 *   --name-field    the property in the file that holds the place's name.
 *   --parent-field  (LGAs) the property holding the state's name. If left out, each LGA's state is
 *                   found by location instead.
 *   --dry-run       check everything and report what would change, but save nothing.
 *   --yes           required to actually save when NODE_ENV=production (an extra "are you sure").
 *
 * Needs DATABASE_URL. It never deletes anything, and it saves nothing unless every feature passes.
 */
function readFlag(args: string[], name: string): string | undefined {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const file = args[0];
  const level = readFlag(args, "level");
  const nameField = readFlag(args, "name-field");
  const parentField = readFlag(args, "parent-field");
  const dryRun = args.includes("--dry-run");

  if (!file || file.startsWith("--") || (level !== "state" && level !== "lga") || !nameField) {
    throw new Error("Usage: pnpm boundaries:import <file.geojson> --level state|lga --name-field <property> [--parent-field <property>] [--dry-run] [--yes]");
  }
  if (process.env.NODE_ENV === "production" && !dryRun && !args.includes("--yes")) {
    throw new Error("Refusing to change production boundaries without --yes. Run with --dry-run first.");
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const json: unknown = JSON.parse(await readFile(file, "utf8"));
  const { db, pool } = createDb(url);
  try {
    const result = await importBoundaryFile(db, json, { level, nameField, parentField, dryRun });
    switch (result.status) {
      case "invalid_file":
        console.error("The file has problems. Nothing was imported:");
        for (const issue of result.issues) console.error(`  feature ${issue.index}: ${issue.code}`);
        process.exitCode = 1;
        break;
      case "rejected":
        console.error("The database rejected some features. Nothing was imported:");
        for (const problem of result.problems) console.error(`  feature ${problem.index} (${problem.name}): ${problem.code}`);
        process.exitCode = 1;
        break;
      case "dry_run":
        console.log(`Dry run: would add ${result.summary.inserted} and update ${result.summary.updated}. Nothing was saved.`);
        break;
      case "imported":
        console.log(`Imported: added ${result.summary.inserted}, updated ${result.summary.updated}.`);
        break;
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Failed");
  process.exit(1);
});
