// Generates TypeScript types and schema-object modules from the normative JSON
// Schemas in packages/contracts/schemas/. Output is committed; run with --check
// to verify the committed output matches (CI drift gate, build spec section 9).
import { compile } from "json-schema-to-typescript";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemasDir = path.join(packageRoot, "schemas");
const outDir = path.join(packageRoot, "src", "generated");

const SCHEMAS = [
  { file: "agent-manifest.schema.json", module: "agent-manifest" },
  { file: "agent-lock.schema.json", module: "agent-lock" },
  { file: "eval-suite.schema.json", module: "eval-suite" },
  { file: "release-policy.schema.json", module: "release-policy" },
  { file: "workflow-state.schema.json", module: "workflow-state" },
];

const BANNER =
  "/* Generated from the normative JSON Schemas by scripts/generate-types.mjs. DO NOT EDIT. */";

async function generate() {
  const outputs = new Map();
  const schemaObjectEntries = [];
  for (const { file, module } of SCHEMAS) {
    const raw = await readFile(path.join(schemasDir, file), "utf8");
    const schema = JSON.parse(raw);
    const ts = await compile(schema, module, {
      bannerComment: BANNER,
      additionalProperties: false,
      format: false,
      unreachableDefinitions: true,
    });
    outputs.set(`${module}.ts`, ts.endsWith("\n") ? ts : `${ts}\n`);
    const constName = module.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) + "Schema";
    schemaObjectEntries.push({ constName, module, raw: raw.trimEnd() });
  }

  let schemaObjects = `${BANNER}\n`;
  for (const { constName, raw } of schemaObjectEntries) {
    schemaObjects += `export const ${constName} = ${raw} as const;\n`;
  }
  schemaObjects += `export const schemas = {\n`;
  for (const { constName, module } of schemaObjectEntries) {
    schemaObjects += `  "${module}": ${constName},\n`;
  }
  schemaObjects += `} as const;\nexport type SchemaName = keyof typeof schemas;\n`;
  outputs.set("schema-objects.ts", schemaObjects);
  return outputs;
}

const checkMode = process.argv.includes("--check");
const outputs = await generate();
let drift = false;
await mkdir(outDir, { recursive: true });
for (const [name, content] of outputs) {
  const target = path.join(outDir, name);
  if (checkMode) {
    const existing = await readFile(target, "utf8").catch(() => null);
    if (existing !== content) {
      console.error(`DRIFT: ${path.relative(packageRoot, target)} does not match its schema.`);
      drift = true;
    }
  } else {
    await writeFile(target, content, "utf8");
    console.log(`wrote ${path.relative(packageRoot, target)}`);
  }
}
if (checkMode) {
  if (drift) {
    console.error("Generated types are stale. Run `pnpm generate` and commit the result.");
    process.exit(1);
  }
  console.log("Generated types match the schemas.");
}
