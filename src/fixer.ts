import { readFile, writeFile } from "node:fs/promises";
import type { FixLogger } from "./config.js";

export type FixTarget = "structured" | "template";

export interface FixOptions {
  target: FixTarget;
  logger: FixLogger;
  dryRun: boolean;
}

export interface Rewrite {
  line: number;
  before: string;
  after: string;
}

export interface FileFixResult {
  filePath: string;
  rewrites: Rewrite[];
  updated: boolean;
}

const STRING_CONCAT_RE =
  /^(\s*)console\.(log|info|warn|error|debug)\(\s*(["'])(.*?)\3\s*,\s*([A-Za-z_$][\w$]*)\s*\)\s*;?\s*$/;
const TEMPLATE_RE = /^(\s*)console\.(log|info|warn|error|debug)\(\s*(`[\s\S]*`)\s*\)\s*;?\s*$/;

export async function fixFiles(filePaths: string[], options: FixOptions): Promise<FileFixResult[]> {
  return Promise.all(filePaths.map((filePath) => fixFile(filePath, options)));
}

export async function fixFile(filePath: string, options: FixOptions): Promise<FileFixResult> {
  const source = await readFile(filePath, "utf8");
  const lines = source.split(/\r?\n/);
  const rewrites: Rewrite[] = [];

  const nextLines = lines.map((line, index) => {
    const rewritten = rewriteLine(line, options);
    if (!rewritten || rewritten === line) {
      return line;
    }

    rewrites.push({
      line: index + 1,
      before: line.trim(),
      after: rewritten.trim()
    });
    return rewritten;
  });

  const updated = rewrites.length > 0;
  if (updated && !options.dryRun) {
    await writeFile(filePath, nextLines.join("\n"), "utf8");
  }

  return { filePath, rewrites, updated };
}

function rewriteLine(line: string, options: FixOptions): string | null {
  const stringConcatMatch = line.match(STRING_CONCAT_RE);
  if (stringConcatMatch) {
    const [, indent, method, , label, value] = stringConcatMatch;
    if (options.target === "structured") {
      return `${indent}${formatCallee(method, options.logger)}({ msg: ${JSON.stringify(stripTrailingColon(label))}, ${value} })`;
    }

    return `${indent}${formatCallee(method, options.logger)}(\`${escapeTemplateText(stripTrailingColon(label))}=\${${value}}\`)`;
  }

  const templateMatch = line.match(TEMPLATE_RE);
  if (templateMatch) {
    const [, indent, method, template] = templateMatch;
    if (options.target === "structured") {
      return `${indent}${formatCallee(method, options.logger)}({ msg: ${template} })`;
    }

    return `${indent}${formatCallee(method, options.logger)}(${template})`;
  }

  return null;
}

function formatCallee(method: string, logger: FixLogger): string {
  const level = method === "log" ? "info" : method;
  if (logger === "console") {
    return `console.${method}`;
  }

  return `logger.${level}`;
}

function stripTrailingColon(label: string): string {
  return label.trim().replace(/:\s*$/, "");
}

function escapeTemplateText(value: string): string {
  return value.replace(/[\\`]/g, "\\$&");
}
