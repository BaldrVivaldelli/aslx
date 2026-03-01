import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

type Args = {
  inDir: string;
  outDir: string;
};

function parseArgs(argv: string[]): Args {
  const get = (name: string) => {
    const idx = argv.indexOf(name);
    return idx >= 0 ? argv[idx + 1] : undefined;
  };

  const inDir = get("--in-dir") ?? "build/machines";
  const outDir = get("--out-dir") ?? inDir;

  return { inDir, outDir };
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function listJsonFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(dir, f));
}

function stableYamlStringify(obj: unknown): string {
  const doc = new YAML.Document(obj);

  // YAML output preferences (MVP):
  // - keep it readable
  // - deterministic enough for golden tests later
  doc.options.indent = 2;
  doc.options.lineWidth = 0; // do not auto-wrap long lines
  doc.options.defaultStringType = "QUOTE_DOUBLE";

  // NOTE: We'll later add special handling for JSONata `{% ... %}`
  // (block scalars, etc.) in Paso 2/3.
  return String(doc);
}

function main() {
  const { inDir, outDir } = parseArgs(process.argv.slice(2));

  ensureDir(outDir);

  const files = listJsonFiles(inDir);
  if (files.length === 0) {
    console.error(`No .json machines found in: ${inDir}`);
    process.exit(1);
  }

  for (const file of files) {
    const jsonText = fs.readFileSync(file, "utf8");
    const data = JSON.parse(jsonText);

    const ymlText = stableYamlStringify(data);

    const outFile = path.join(outDir, path.basename(file).replace(/\.json$/, ".yml"));
    fs.writeFileSync(outFile, ymlText, "utf8");
  }

  console.log(`✅ Generated ${files.length} YAML machine(s) into: ${outDir}`);
}

main();