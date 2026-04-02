#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import { DEFAULT_CONFIG, loadConfig } from "./config.js";
import { fixFiles, type FixTarget } from "./fixer.js";
import { formatJson, formatReport } from "./formatter.js";
import { createReport } from "./reporter.js";
import { resolveScanFiles, scanPath } from "./scanner.js";

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
  .option("--fix", "Rewrite supported log calls to a consistent target style")
  .option("--target <style>", "Rewrite target style: structured or template", "structured")
  .option("--dry-run", "Preview rewrites without writing files")
  .option("--config <path>", "Path to .logshaperc JSON config")
  .action(async (targetPath: string, options) => {
    const loadedConfig = await loadConfig(options.config);
    const config = loadedConfig?.config ?? DEFAULT_CONFIG;
    const extensions = splitCsv(options.ext);
    const ignore = [...new Set([...splitCsv(options.ignore), ...config.ignoreFiles])];
    const resolvedPath = path.resolve(targetPath);
    const target = parseTarget(options.target);

    if (loadedConfig) {
      process.stdout.write(`Using config: ${path.relative(process.cwd(), loadedConfig.path) || path.basename(loadedConfig.path)}\n`);
      if (config.allowStyles.length < DEFAULT_CONFIG.allowStyles.length) {
        process.stdout.write(`Only allowing: ${config.allowStyles.join(", ")} style${config.allowStyles.length === 1 ? "" : "s"}\n`);
      }
      if (config.ignoreFiles.length > 0) {
        process.stdout.write(`Ignoring: ${config.ignoreFiles.join(", ")}\n`);
      }
    }

    if (options.fix) {
      const files = await resolveScanFiles(resolvedPath, { extensions, ignore });
      const fixResults = await fixFiles(files, {
        target,
        logger: config.logger,
        dryRun: Boolean(options.dryRun)
      });
      const rewrites = fixResults.flatMap((result) => result.rewrites.map((rewrite) => ({ filePath: result.filePath, ...rewrite })));
      const mode = options.dryRun ? "Would rewrite" : "Rewriting";
      process.stdout.write(`${mode} ${rewrites.length} supported call${rewrites.length === 1 ? "" : "s"} to ${target} format...\n`);
      for (const rewrite of rewrites) {
        const displayPath = path.relative(process.cwd(), rewrite.filePath) || path.basename(rewrite.filePath);
        process.stdout.write(`  ${displayPath}:${rewrite.line}  ${rewrite.before}  ->  ${rewrite.after}\n`);
      }
      process.stdout.write(
        `${rewrites.length} call${rewrites.length === 1 ? "" : "s"} ${options.dryRun ? "would be rewritten" : "rewritten"}.` +
          `${options.dryRun ? "\n" : " Review changes with: git diff\n"}`
      );
      if (!options.dryRun) {
        process.stdout.write("");
      }
      return;
    }

    const scanResult = await scanPath(resolvedPath, { extensions, ignore });
    const report = createReport(scanResult.calls, scanResult.files.length, {
      extensions,
      ignore,
      allowStyles: config.allowStyles,
      maxMixedStyles: config.maxMixedStyles
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

function parseTarget(value: string): FixTarget {
  if (value === "structured" || value === "template") {
    return value;
  }

  throw new Error(`Unsupported --target value: ${value}`);
}
