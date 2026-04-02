#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import { formatJson, formatReport } from "./formatter.js";
import { createReport } from "./reporter.js";
import { scanPath } from "./scanner.js";

const DEFAULT_EXTENSIONS = [".ts", ".js", ".tsx", ".jsx"];
const DEFAULT_IGNORES = ["node_modules", "dist", "test"];

const program = new Command();

program
  .name("log-shape")
  .argument("<path>", "Path to scan")
  .option("--json", "JSON output")
  .option("--no-fail", "Don't exit 1 on issues")
  .option("--ext <exts>", "Extensions to scan (comma-separated)", DEFAULT_EXTENSIONS.join(","))
  .option("--ignore <pat>", "Glob patterns to ignore (comma-separated)", DEFAULT_IGNORES.join(","))
  .option("--suggest", "Show migration suggestions (pino/winston snippets)")
  .action(async (targetPath: string, options) => {
    const extensions = splitCsv(options.ext);
    const ignore = splitCsv(options.ignore);
    const resolvedPath = path.resolve(targetPath);

    const scanResult = await scanPath(resolvedPath, { extensions, ignore });
    const report = createReport(scanResult.calls, scanResult.files.length, {
      extensions,
      ignore
    });

    const output = options.json ? formatJson(report, process.cwd()) : formatReport(report, process.cwd(), options.suggest);
    process.stdout.write(`${output}\n`);

    if (report.hasMixedStyles && options.fail) {
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
