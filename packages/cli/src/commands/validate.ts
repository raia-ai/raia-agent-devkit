/**
 * `raia validate` (build spec section 20): schema, reference, secret, policy,
 * and lock checks against the exact working tree. Side effect: reports only.
 */
import path from "node:path";
import { validateProject } from "@raia/core";
import { EXIT } from "../exit-codes.js";
import { emitResult, type CliIO, type GlobalFlags } from "../io.js";
import { VALIDATION_REPORT_PATH, writeFileAtomic } from "../project-files.js";

export async function runValidate(io: CliIO, flags: GlobalFlags): Promise<number> {
  const projectRoot = io.cwd;
  const result = await validateProject(projectRoot);

  const report = { generatedAt: new Date().toISOString(), ...result };
  await writeFileAtomic(
    path.join(projectRoot, VALIDATION_REPORT_PATH),
    JSON.stringify(report, null, 2) + "\n",
  );

  const human: string[] = [
    `validation: ${result.ok ? "PASS" : "FAIL"} (rule set v${result.ruleSetVersion})`,
  ];
  for (const finding of result.findings) {
    human.push(
      `  [${finding.severity}] ${finding.code} ${finding.path ?? ""} — ${finding.message}`,
    );
  }
  if (result.candidateSha256 !== undefined) {
    human.push(`  candidate: ${result.candidateSha256}`);
  }
  human.push(`  report:    ${VALIDATION_REPORT_PATH}`);

  emitResult(io, flags, { ...result, reportPath: VALIDATION_REPORT_PATH }, human);
  return result.ok ? EXIT.OK : EXIT.VALIDATION;
}
