/**
 * CLI program assembly. `run` is pure with respect to the process: it takes
 * argv and injected I/O and returns an exit code, so contract tests run the
 * CLI in-process (build spec section 27, "CLI contract tests").
 */
import { Command, CommanderError } from "commander";
import { EXIT, reportError } from "./exit-codes.js";
import type { CliIO, GlobalFlags } from "./io.js";
import { runDoctor } from "./commands/doctor.js";
import { runInit } from "./commands/init.js";
import { runValidate } from "./commands/validate.js";
import { runDiff } from "./commands/diff.js";
import { runStatus } from "./commands/status.js";
import { runTest } from "./commands/test.js";
import { runReview } from "./commands/review.js";
import { runReleaseCreate } from "./commands/release.js";
import { runDeploy } from "./commands/deploy.js";

export const CLI_VERSION = "0.1.0";

export async function run(argv: string[], io: CliIO): Promise<number> {
  let exitCode: number = EXIT.OK;
  const program = new Command();

  program
    .name("raia")
    .description("Manage a raia agent as versioned software.")
    .version(CLI_VERSION)
    .option("--json", "emit one stable JSON object on stdout", false)
    .option("--profile <name>", "credential/config profile", "default")
    .option("--api-base-url <url>", "management API base URL identifier")
    .option("--region <region>", "us | eu | custom", "us")
    .option("--no-color", "disable colored output")
    .option("--non-interactive", "never prompt; fail instead", false)
    .exitOverride()
    .configureOutput({
      writeOut: (text) => io.stdout(text.replace(/\n$/, "")),
      writeErr: (text) => io.stderr(text.replace(/\n$/, "")),
    });

  const flags = (): GlobalFlags => {
    const opts = program.opts<{
      json: boolean;
      profile: string;
      apiBaseUrl?: string;
      region: string;
      color: boolean;
      nonInteractive: boolean;
    }>();
    return {
      json: opts.json,
      profile: opts.profile,
      apiBaseUrl: opts.apiBaseUrl,
      region: opts.region,
      color: opts.color,
      nonInteractive: opts.nonInteractive,
    };
  };

  program
    .command("doctor")
    .description("Check runtime, project files, credentials, and provider reachability.")
    .action(async () => {
      exitCode = await runDoctor(io, flags());
    });

  program
    .command("init")
    .description("Create a project from a fixture (mock provider) or bind to an agent.")
    .option("--provider <name>", "management provider", "mock")
    .option("--fixture <nameOrPath>", "fixture project to seed the mock provider with")
    .option("--agent <id>", "agent id to bind (when the provider is already seeded)")
    .option("--dir <path>", "target project directory (default: current directory)")
    .option("--force", "overwrite modified files after review", false)
    .option("-y, --yes", "skip the preview confirmation", false)
    .action(async (options: Record<string, unknown>) => {
      exitCode = await runInit(io, flags(), {
        provider: String(options["provider"]),
        fixture: options["fixture"] as string | undefined,
        agent: options["agent"] as string | undefined,
        dir: options["dir"] as string | undefined,
        force: Boolean(options["force"]),
        yes: Boolean(options["yes"]),
      });
    });

  program
    .command("validate")
    .description("Run schema, reference, secret, policy, and lock checks; write a report.")
    .action(async () => {
      exitCode = await runValidate(io, flags());
    });

  program
    .command("diff")
    .description("Semantic diff of the working tree against lock, remote, or a version.")
    .option("--against <target>", "lock | remote | version:<id>", "lock")
    .action(async (options: Record<string, unknown>) => {
      exitCode = await runDiff(io, flags(), { against: String(options["against"]) });
    });

  program
    .command("status")
    .description("Show binding, candidate hash, drift, evidence, release, and deployment.")
    .action(async () => {
      exitCode = await runStatus(io, flags());
    });

  program
    .command("test")
    .description("Execute evaluation suites (fixture mode by default) and write evidence reports.")
    .option("--mode <mode>", "fixture | live (live requires explicit selection)", "fixture")
    .option("--suite <path...>", "suite file(s) to run (default: manifest suites)")
    .option("--baseline <path>", "prior evaluation.json to compare against")
    .option("--seed <n>", "deterministic seed", (v: string) => Number.parseInt(v, 10))
    .option("--repetitions <n>", "repetitions per case", (v: string) => Number.parseInt(v, 10))
    .action(async (options: Record<string, unknown>) => {
      exitCode = await runTest(io, flags(), {
        mode: String(options["mode"]),
        suite: options["suite"] as string[] | undefined,
        baseline: options["baseline"] as string | undefined,
        seed: options["seed"] as number | undefined,
        repetitions: options["repetitions"] as number | undefined,
      });
    });

  program
    .command("review")
    .description("Aggregate diff, validation, evaluation, risk, and release-policy evidence.")
    .action(async () => {
      exitCode = await runReview(io, flags());
    });

  const release = program.command("release").description("Manage immutable release candidates.");
  release
    .command("create")
    .description("Create an immutable release candidate from verified evidence.")
    .option("-y, --yes", "skip the preview confirmation", false)
    .action(async (options: Record<string, unknown>) => {
      exitCode = await runReleaseCreate(io, flags(), { yes: Boolean(options["yes"]) });
    });

  program
    .command("deploy")
    .description("Deploy an approved release candidate to staging.")
    .argument("<environment>", "target environment (staging)")
    .option("-y, --yes", "skip the preview confirmation", false)
    .action(async (environment: string, options: Record<string, unknown>) => {
      exitCode = await runDeploy(io, flags(), {
        environment,
        yes: Boolean(options["yes"]),
      });
    });

  try {
    await program.parseAsync(argv, { from: "user" });
    return exitCode;
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.code === "commander.helpDisplayed" || error.code === "commander.version") {
        return EXIT.OK;
      }
      return EXIT.USAGE;
    }
    return reportError(io, flags(), error);
  }
}
