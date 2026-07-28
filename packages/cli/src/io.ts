/**
 * Injected CLI I/O so contract tests run the CLI in-process
 * (build spec section 20: human output → stdout, diagnostics → stderr;
 * JSON mode emits exactly one stable object).
 */
export interface CliIO {
  cwd: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export interface GlobalFlags {
  json: boolean;
  profile: string;
  region: string;
  apiBaseUrl: string | undefined;
  color: boolean;
  nonInteractive: boolean;
}

export function emitResult(io: CliIO, flags: GlobalFlags, json: object, human: string[]): void {
  if (flags.json) {
    io.stdout(JSON.stringify(json, null, 2));
  } else {
    for (const line of human) {
      io.stdout(line);
    }
  }
}
