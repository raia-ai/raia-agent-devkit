// Enforces the build spec section 27 coverage floors from the vitest
// json-summary report, using the spec's exact scopes: 90% lines and branches
// for core, 85% for providers and the evaluation engine, 80% overall
// (aggregate). Run after `vitest run --coverage`.
import { readFile } from "node:fs/promises";
import process from "node:process";

const FLOORS = {
  core: { lines: 90, branches: 90 },
  providers: { lines: 85, branches: 85 },
  "eval-engine": { lines: 85, branches: 85 },
  overall: { lines: 80, branches: 80 },
};

function scopeOf(filePath) {
  if (filePath.includes("/packages/core/")) return "core";
  if (
    filePath.includes("/packages/provider-mock/") ||
    filePath.includes("/packages/provider-http/") ||
    filePath.includes("/packages/conversation-client/")
  ) {
    return "providers";
  }
  if (filePath.includes("/packages/eval-engine/")) return "eval-engine";
  return "other";
}

const summary = JSON.parse(await readFile("coverage/coverage-summary.json", "utf8"));
const totals = {};
const bump = (scope, metric, covered, total) => {
  totals[scope] ??= { lines: [0, 0], branches: [0, 0] };
  totals[scope][metric][0] += covered;
  totals[scope][metric][1] += total;
};
for (const [filePath, metrics] of Object.entries(summary)) {
  if (filePath === "total") continue;
  for (const scope of [scopeOf(filePath), "overall"]) {
    bump(scope, "lines", metrics.lines.covered, metrics.lines.total);
    bump(scope, "branches", metrics.branches.covered, metrics.branches.total);
  }
}

let failed = false;
for (const [scope, floor] of Object.entries(FLOORS)) {
  const measured = totals[scope];
  if (measured === undefined) {
    console.error(`No coverage data for scope "${scope}".`);
    failed = true;
    continue;
  }
  for (const metric of ["lines", "branches"]) {
    const [covered, total] = measured[metric];
    const pct = total === 0 ? 100 : (100 * covered) / total;
    const ok = pct >= floor[metric];
    console.log(
      `${ok ? "ok  " : "FAIL"} ${scope} ${metric}: ${pct.toFixed(2)}% (floor ${floor[metric]}%)`,
    );
    if (!ok) failed = true;
  }
}
if (failed) {
  console.error("Coverage floors not met (build spec section 27).");
  process.exit(1);
}
console.log("All coverage floors met.");
