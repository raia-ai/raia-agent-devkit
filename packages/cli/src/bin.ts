#!/usr/bin/env node
import process from "node:process";
import { run } from "./run.js";

const code = await run(process.argv.slice(2), {
  cwd: process.cwd(),
  stdout: (line) => process.stdout.write(line + "\n"),
  stderr: (line) => process.stderr.write(line + "\n"),
});
process.exit(code);
