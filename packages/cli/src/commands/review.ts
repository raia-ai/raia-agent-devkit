/**
 * `raia review` (build spec sections 20 and 22): aggregate diff, validation,
 * evaluation, risk, and release-policy evidence into a signed-by-hash summary.
 * Report only — no remote object is created. Exit 0 when release-ready,
 * exit 3 when blockers remain.
 */
import path from "node:path";
import { hashCanonical } from "@raia/core";
import { EXIT } from "../exit-codes.js";
import { emitResult, type CliIO, type GlobalFlags } from "../io.js";
import { writeFileAtomic } from "../project-files.js";
import { aggregateReadiness } from "../readiness.js";

const REVIEW_JSON = "reports/latest/review.json";
const REVIEW_MD = "reports/latest/review.md";

export async function runReview(io: CliIO, flags: GlobalFlags): Promise<number> {
  const projectRoot = io.cwd;
  const aggregate = await aggregateReadiness(projectRoot);
  const { validation, changes, risk, drift, evaluationSummary, policyResult, blockers, ready } =
    aggregate;

  const reviewPayload = {
    ready,
    candidateSha256: validation.candidateSha256 ?? null,
    manifestSha256: aggregate.local.manifestSha256,
    lockSha256: validation.lockSha256 ?? null,
    baseVersionId: aggregate.baseVersionId,
    risk,
    changeCount: changes.length,
    changes,
    drift,
    validation: {
      ok: validation.ok,
      findings: validation.findings,
      evidenceSha256: validation.evidenceSha256 ?? null,
    },
    evaluation: evaluationSummary,
    policy: { name: aggregate.policyName, requirements: policyResult.requirements },
    blockers,
  };
  const evidenceSha256 = hashCanonical(reviewPayload);
  const report = { generatedAt: new Date().toISOString(), evidenceSha256, ...reviewPayload };

  await writeFileAtomic(
    path.join(projectRoot, REVIEW_JSON),
    JSON.stringify(report, null, 2) + "\n",
  );
  const md: string[] = [
    `# Release review`,
    "",
    `- Ready: **${ready ? "YES" : "NO"}**`,
    `- Candidate: ${reviewPayload.candidateSha256 ?? "unknown"}`,
    `- Risk: ${risk} (${changes.length} semantic change(s) vs base ${aggregate.baseVersionId})`,
    `- Validation: ${validation.ok ? "pass" : "FAIL"}`,
    `- Evaluation: ${
      evaluationSummary === null
        ? "missing"
        : `${evaluationSummary.runId} (gate ${evaluationSummary.gatePassed ? "passed" : "failed"}, ${
            evaluationSummary.bound ? "bound" : "STALE"
          })`
    }`,
    "",
    "## Policy requirements",
    "",
    "| Requirement | Satisfied | Detail |",
    "| --- | --- | --- |",
    ...policyResult.requirements.map(
      (r) => `| ${r.id} | ${r.satisfied ? "✅" : "❌"} | ${r.message} |`,
    ),
    "",
    `Evidence hash: \`${evidenceSha256}\``,
    "",
  ];
  await writeFileAtomic(path.join(projectRoot, REVIEW_MD), md.join("\n"));

  const human: string[] = [
    `review: ${ready ? "READY for release" : "NOT ready"} — risk ${risk}, ${changes.length} change(s)`,
  ];
  for (const blocker of blockers) {
    human.push(`  ⛔ ${blocker}`);
  }
  human.push(`  reports: ${REVIEW_JSON}, ${REVIEW_MD}`);

  emitResult(io, flags, { ok: ready, ...report, reportPaths: [REVIEW_JSON, REVIEW_MD] }, human);
  return ready ? EXIT.OK : EXIT.VALIDATION;
}
