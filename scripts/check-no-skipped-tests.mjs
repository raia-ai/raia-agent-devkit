// Build spec section 27: CI runs with no skipped tests. This forbids the
// skip/todo/only escape hatches in committed test files (`.only` would also
// silently shrink the suite).
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const FORBIDDEN =
  /\b(?:it|test|describe)\s*\.\s*(?:skip|todo|only)\s*\(|\bxit\s*\(|\bxdescribe\s*\(/;

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (/\.test\.ts$/.test(entry.name)) {
      yield full;
    }
  }
}

let failed = false;
let count = 0;
for (const root of ["packages", "apps"]) {
  for await (const file of walk(root)) {
    count += 1;
    const content = await readFile(file, "utf8");
    const match = FORBIDDEN.exec(content);
    if (match !== null) {
      console.error(`Skipped/only test construct in ${file}: ${match[0].trim()}`);
      failed = true;
    }
  }
}
if (failed) {
  process.exit(1);
}
console.log(`No skipped/only tests across ${count} test files.`);
