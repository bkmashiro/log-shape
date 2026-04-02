import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { classifyLogCall } from "../src/detector.js";
import { createReport } from "../src/reporter.js";
import { extractLogCallsFromText, scanPath } from "../src/scanner.js";

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

test("single-style file is not flagged", () => {
  const calls = extractLogCallsFromText(
    ['console.log("a:", value)', 'console.error("b:", err)'].join("\n"),
    "/tmp/one-style.ts"
  );
  const report = createReport(calls, 1, { extensions: [".ts"], ignore: [] });
  assert.equal(report.flaggedFiles.length, 0);
});

test("three-style file is flagged", () => {
  const calls = extractLogCallsFromText(
    ['console.log("a:", value)', "console.log(`b=${value}`)", "console.log(obj)"].join("\n"),
    "/tmp/mixed.ts"
  );
  const report = createReport(calls, 1, { extensions: [".ts"], ignore: [] });
  assert.equal(report.flaggedFiles.length, 1);
});

test("unknown styles do not cause a file to be flagged", () => {
  const calls = extractLogCallsFromText(
    ["console.log()", 'console.log("a:", value)', 'console.error("b:", err)'].join("\n"),
    "/tmp/mostly-one-style.ts"
  );
  const report = createReport(calls, 1, { extensions: [".ts"], ignore: [] });
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
