export { DevkitError, type DevkitErrorCode } from "./errors.js";
export {
  canonicalJson,
  hashCanonical,
  hashFileContent,
  isSha256,
  normalizeLineEndings,
  sha256OfUtf8,
} from "./hash/canonical.js";
export { nodeFileSystem, type FileSystem } from "./fs/file-system.js";
export { resolveProjectPath, type ResolvedProjectPath } from "./fs/safe-paths.js";
export {
  redactText,
  redactValue,
  scanForSecrets,
  SECRET_RULE_SET_VERSION,
  type SecretFinding,
} from "./redaction/redact.js";
export { validateAgainstSchema, type SchemaIssue } from "./schema/validators.js";
export {
  collectFileReferences,
  findDuplicateNames,
  loadManifest,
  MANIFEST_FILE_NAME,
  type LoadedArtifact,
  type LoadedManifest,
} from "./manifest/load.js";
export {
  collectFixtureRefs,
  loadEvaluationSuite,
  loadReleasePolicy,
  type LoadedReleasePolicy,
  type LoadedSuite,
} from "./evals/resources.js";
export { checkLockDrift, lockSha256, parseLock, type LockDrift } from "./lock/lock.js";
export { computeCandidateSha256, CORE_VERSION, type CandidateInput } from "./candidate.js";
export {
  diffManifests,
  isInputSchemaBroadened,
  isInputSchemaIncompatible,
  type ManifestSnapshot,
  type SemanticDiffResult,
} from "./diff/semantic-diff.js";
export {
  evaluateReleasePolicy,
  type PolicyEvaluationInput,
  type PolicyEvaluationResult,
  type PolicyRequirementResult,
} from "./policy/policy.js";
export {
  LOCK_FILE_NAME,
  validateProject,
  VALIDATION_RULE_SET_VERSION,
  type FindingSeverity,
  type ValidationFinding,
  type ValidationResult,
} from "./validation/validate.js";
