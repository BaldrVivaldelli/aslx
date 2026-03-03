#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCliSubcommand } from "./load-module.js";

type Command = {
  name: string;
  description: string;
  file: string; // baseName del archivo en dist/cli
  aliases?: string[];
};

const COMMANDS: Command[] = [
  { name: "compile", description: "Compile TypeScript slots into JSONata registry (slots.json + slots.map.json).", file: "compile-jsonata", aliases: ["compile-jsonata", "slots"] },
  { name: "build", description: "Build ASL JSON definition(s) from exported stateMachine(...) builders.", file: "build-machine", aliases: ["build-machine"] },
  { name: "validate", description: "Validate exported stateMachine(...) builders (graph + semantics).", file: "validate-machine", aliases: ["validate-machine", "check"] },
  { name: "yml", description: "Convert built .json machine definitions to .yml.", file: "build-yml", aliases: ["build-yml", "yaml"] },
];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getVersion(): string | null {
  try {
    const pkgPath = path.resolve(__dirname, "../../package.json");
    const raw = fs.readFileSync(pkgPath, "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

function resolveCommand(name: string): Command | null {
  const normalized = name.trim();
  return (
    COMMANDS.find((c) => c.name === normalized) ??
    COMMANDS.find((c) => (c.aliases ?? []).includes(normalized)) ??
    null
  );
}

function printHelp() {
  const version = getVersion();
  const header = version ? `aslx v${version}` : "aslx";
  const maxName = Math.max(...COMMANDS.map((c) => c.name.length));
  const lines = COMMANDS.map((c) => {
    const alias = c.aliases?.length ? ` (aliases: ${c.aliases.join(", ")})` : "";
    return `  ${c.name.padEnd(maxName)}  ${c.description}${alias}`;
  }).join("\n");

  console.log(`${header}

Usage:
  aslx <command> [args...]

Commands:
${lines}

Options:
  -h, --help     Show this help
  -v, --version  Print version
`);
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0) {
    printHelp();
    process.exitCode = 0;
    return;
  }

  const first = argv[0] ?? "";

  if (first === "--help" || first === "-h" || first === "help") {
    const maybeCmd = argv[1];
    if (first === "help" && maybeCmd) {
      const cmd = resolveCommand(maybeCmd);
      if (!cmd) {
        console.error(`Unknown command: ${maybeCmd}`);
        printHelp();
        process.exitCode = 1;
        return;
      }
      process.exitCode = await runCliSubcommand(cmd.file, ["--help"]);
      return;
    }
    printHelp();
    process.exitCode = 0;
    return;
  }

  if (first === "--version" || first === "-v") {
    console.log(getVersion() ?? "unknown");
    process.exitCode = 0;
    return;
  }

  const cmd = resolveCommand(first);
  if (!cmd) {
    console.error(`Unknown command: ${first}`);
    printHelp();
    process.exitCode = 1;
    return;
  }

  process.exitCode = await runCliSubcommand(cmd.file, argv.slice(1));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});