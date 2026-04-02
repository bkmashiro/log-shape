import test from "node:test";
import assert from "node:assert/strict";
import { classifyLogCall } from "../src/detector.js";
import { createReport } from "../src/reporter.js";
import { extractLogCallsFromText } from "../src/scanner.js";

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
