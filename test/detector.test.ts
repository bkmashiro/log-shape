import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, writeFile, mkdir, readFile } from "node:fs/promises";
import { DEFAULT_CONFIG, loadConfig } from "../src/config.js";
import { classifyLogCall } from "../src/detector.js";
import { fixFile } from "../src/fixer.js";
import { formatHtmlReport, formatJsonReport } from "../src/formatter.js";
import { migrateFile } from "../src/migrator.js";
import { createReport } from "../src/reporter.js";
import { extractLogCallsFromText, scanPath } from "../src/scanner.js";

const reportDefaults = {
  extensions: [".ts"],
  ignore: [],
  allowStyles: DEFAULT_CONFIG.allowStyles,
  maxMixedStyles: DEFAULT_CONFIG.maxMixedStyles
} as const;

test("classifies string concat", () => {
  assert.equal(classifyLogCall('console.log("user:", user)')?.style, "string-concat");
});

test("classifies template literal", () => {
  assert.equal(classifyLogCall("console.log(`token=${token}`)")?.style, "template-literal");
});

test("classifies raw dump", () => {
  assert.equal(classifyLogCall("console.log(obj)")?.style, "raw-dump");
});

test("classifies plain string", () => {
  assert.equal(classifyLogCall('console.log("simple message")')?.style, "plain-string");
});

test("classifies structured logger call", () => {
  assert.equal(classifyLogCall('logger.info({ msg: "ok" })')?.style, "structured");
});

test("classifies bunyan structured logger call", () => {
  assert.equal(classifyLogCall('bunyan.info({ msg: "ok" })')?.style, "structured");
});

test("classifies console.error as string concat", () => {
  assert.equal(classifyLogCall('console.error("Failed:", err)')?.style, "string-concat");
});

test("returns null for non-log lines", () => {
  assert.equal(classifyLogCall("const value = 1"), null);
});

test("classifies empty argument list as unknown", () => {
  assert.equal(classifyLogCall("console.log()")?.style, "unknown");
});

test("classifies comma-free non-string expressions as raw dumps", () => {
  assert.equal(classifyLogCall("console.log(user?.profile)")?.style, "raw-dump");
});

test("classifies unsupported argument shapes as unknown", () => {
  assert.equal(classifyLogCall("console.log([foo, bar])")?.style, "unknown");
});

test("extracts line numbers correctly", () => {
  const source = [
    'console.log("simple message")',
    "const x = 1",
    "console.log(obj)"
  ].join("\n");

  const calls = extractLogCallsFromText(source, "/tmp/sample.ts");
  assert.deepEqual(
    calls.map((call) => ({ line: call.line, style: call.style })),
    [
      { line: 1, style: "plain-string" },
      { line: 3, style: "raw-dump" }
    ]
  );
});

test("report respects maxMixedStyles config", () => {
  const calls = extractLogCallsFromText(
    ['console.log("a:", value)', "console.log(`b=${value}`)", "console.log(obj)"].join("\n"),
    "/tmp/mixed-threshold.ts"
  );
  const report = createReport(calls, 1, {
    extensions: [".ts"],
    ignore: [],
    allowStyles: DEFAULT_CONFIG.allowStyles,
    maxMixedStyles: 3
  });
  assert.equal(report.flaggedFiles.length, 0);
});

test("report flags styles disallowed by config", () => {
  const calls = extractLogCallsFromText(['console.log("a:", value)', 'logger.info({ msg: "ok" })'].join("\n"), "/tmp/disallowed.ts");
  const report = createReport(calls, 1, {
    extensions: [".ts"],
    ignore: [],
    allowStyles: ["structured"],
    maxMixedStyles: 2
  });
  assert.equal(report.flaggedFiles.length, 1);
  assert.equal(report.flaggedFiles[0]?.disallowedCalls.length, 1);
  assert.equal(report.flaggedFiles[0]?.disallowedCalls[0]?.style, "string-concat");
});

test("loadConfig reads .logshaperc JSON", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "log-shape-config-"));
  const configPath = path.join(tempDir, ".logshaperc");
  await writeFile(
    configPath,
    JSON.stringify({
      logger: "console",
      allowStyles: ["structured"],
      ignoreFiles: ["src/legacy/**"],
      maxMixedStyles: 1
    }),
    "utf8"
  );

  const loaded = await loadConfig(configPath);
  assert.deepEqual(loaded, {
    path: configPath,
    config: {
      logger: "console",
      allowStyles: ["structured"],
      ignoreFiles: ["src/legacy/**"],
      maxMixedStyles: 1
    }
  });
});

test("fixFile rewrites string concat to structured logger call", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "log-shape-fix-"));
  const filePath = path.join(tempDir, "sample.ts");
  await writeFile(filePath, 'console.log("user:", user)\n', "utf8");

  const result = await fixFile(filePath, { target: "structured", logger: "pino", dryRun: false });
  const updated = await readFile(filePath, "utf8");

  assert.equal(result.rewrites.length, 1);
  assert.equal(updated.trim(), 'logger.info({ msg: "user", user })');
});

test("fixFile dry-run previews template rewrite without writing", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "log-shape-fix-preview-"));
  const filePath = path.join(tempDir, "sample.ts");
  await writeFile(filePath, "console.log(`x=${x}`)\n", "utf8");

  const result = await fixFile(filePath, { target: "structured", logger: "console", dryRun: true });
  const unchanged = await readFile(filePath, "utf8");

  assert.equal(result.rewrites[0]?.after, "console.log({ msg: `x=${x}` })");
  assert.equal(unchanged.trim(), "console.log(`x=${x}`)");
});

test("migrateFile rewrites to pino style and inserts import", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "log-shape-migrate-pino-"));
  const filePath = path.join(tempDir, "sample.ts");
  await writeFile(filePath, 'console.log("user:", user)\n', "utf8");

  const result = await migrateFile(filePath, { target: "pino", dryRun: false });
  const updated = await readFile(filePath, "utf8");

  assert.equal(result.addedImport, 'import logger from "pino";');
  assert.equal(result.rewrites[0]?.after, 'logger.info({ msg: "user", user })');
  assert.equal(updated.trim(), ['import logger from "pino";', 'logger.info({ msg: "user", user })'].join("\n"));
});

test("migrateFile rewrites to winston style", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "log-shape-migrate-winston-"));
  const filePath = path.join(tempDir, "sample.ts");
  await writeFile(filePath, 'console.error("DB:", err)\n', "utf8");

  const result = await migrateFile(filePath, { target: "winston", dryRun: false });

  assert.equal(result.addedImport, 'import logger from "winston";');
  assert.equal(result.rewrites[0]?.after, 'logger.error({ msg: "DB", err })');
});

test("migrateFile rewrites to bunyan style", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "log-shape-migrate-bunyan-"));
  const filePath = path.join(tempDir, "sample.ts");
  await writeFile(filePath, 'console.warn("retry:", count)\n', "utf8");

  const result = await migrateFile(filePath, { target: "bunyan", dryRun: false });

  assert.equal(result.addedImport, 'import logger from "bunyan";');
  assert.equal(result.rewrites[0]?.after, 'logger.warn({ msg: "retry", count })');
});

test("migrateFile rewrites logger calls back to console and removes import", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "log-shape-migrate-console-"));
  const filePath = path.join(tempDir, "sample.ts");
  await writeFile(filePath, 'import logger from "pino";\nlogger.info({ msg: "ok" })\n', "utf8");

  const result = await migrateFile(filePath, { target: "console", dryRun: false });
  const updated = await readFile(filePath, "utf8");

  assert.equal(result.removedImport, 'import logger from "pino";');
  assert.equal(result.rewrites[0]?.after, 'console.info({ msg: "ok" })');
  assert.equal(updated.trim(), 'console.info({ msg: "ok" })');
});

test("single-style file is not flagged", () => {
  const calls = extractLogCallsFromText(
    ['console.log("a:", value)', 'console.error("b:", err)'].join("\n"),
    "/tmp/one-style.ts"
  );
  const report = createReport(calls, 1, reportDefaults);
  assert.equal(report.flaggedFiles.length, 0);
});

test("three-style file is flagged", () => {
  const calls = extractLogCallsFromText(
    ['console.log("a:", value)', "console.log(`b=${value}`)", "console.log(obj)"].join("\n"),
    "/tmp/mixed.ts"
  );
  const report = createReport(calls, 1, reportDefaults);
  assert.equal(report.flaggedFiles.length, 1);
  assert.equal(report.summary.totalCalls, 3);
  assert.equal(report.summary.styles["raw-dump"], 1);
  assert.equal(report.summary.score, 78);
});

test("unknown styles do not cause a file to be flagged", () => {
  const calls = extractLogCallsFromText(
    ["console.log()", 'console.log("a:", value)', 'console.error("b:", err)'].join("\n"),
    "/tmp/mostly-one-style.ts"
  );
  const report = createReport(calls, 1, reportDefaults);
  assert.equal(report.flaggedFiles.length, 0);
});

test("scanPath reads a single file target", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "log-shape-file-"));
  const filePath = path.join(tempDir, "sample.ts");
  await writeFile(filePath, ['console.log("hello")', "console.log(obj)"].join("\n"), "utf8");

  const result = await scanPath(filePath, { extensions: ["ts"], ignore: [] });

  assert.deepEqual(result.files, [filePath]);
  assert.deepEqual(
    result.calls.map((call) => ({ line: call.line, style: call.style, code: call.code })),
    [
      { line: 1, style: "plain-string", code: 'console.log("hello")' },
      { line: 2, style: "raw-dump", code: "console.log(obj)" }
    ]
  );
});

test("scanPath scans directories with normalized extensions and ignore rules", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "log-shape-dir-"));
  const srcDir = path.join(tempDir, "src");
  const nestedDir = path.join(srcDir, "nested");
  const ignoredDir = path.join(tempDir, "build");
  await mkdir(nestedDir, { recursive: true });
  await mkdir(ignoredDir, { recursive: true });

  await writeFile(path.join(srcDir, "first.ts"), 'console.log("a:", value)\nconst x = 1\n', "utf8");
  await writeFile(path.join(nestedDir, "second.js"), "logger.info({ msg: 'ok' })\n", "utf8");
  await writeFile(path.join(srcDir, "skip.txt"), "console.log(obj)\n", "utf8");
  await writeFile(path.join(ignoredDir, "ignored.ts"), "console.log(obj)\n", "utf8");

  const result = await scanPath(tempDir, { extensions: ["ts", ".js"], ignore: ["build", ""] });

  assert.equal(result.files.length, 2);
  assert.deepEqual(
    result.files.map((filePath) => path.relative(tempDir, filePath)).sort(),
    ["src/first.ts", "src/nested/second.js"]
  );
  assert.deepEqual(
    result.calls.map((call) => ({
      filePath: path.relative(tempDir, call.filePath),
      style: call.style,
      line: call.line
    })),
    [
      { filePath: "src/first.ts", style: "string-concat", line: 1 },
      { filePath: "src/nested/second.js", style: "structured", line: 1 }
    ]
  );
});

test("formatters include summary in json and html modes", () => {
  const calls = extractLogCallsFromText(
    ['console.log("a:", value)', "console.log(`b=${value}`)", "console.log(obj)"].join("\n"),
    "/tmp/report.ts"
  );
  const report = createReport(calls, 1, reportDefaults);

  const json = JSON.parse(formatJsonReport(report, "/tmp"));
  const html = formatHtmlReport(report, "/tmp");

  assert.equal(json.summary.totalCalls, 3);
  assert.deepEqual(json.summary.inconsistentFiles, ["report.ts"]);
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /Score 78\/100/);
});
