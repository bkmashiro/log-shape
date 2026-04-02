import { readFile, writeFile } from "node:fs/promises";
import { classifyLogCall } from "./detector.js";

export type MigrationTarget = "pino" | "winston" | "bunyan" | "console";

export interface MigrationOptions {
  target: MigrationTarget;
  dryRun: boolean;
}

export interface MigrationRewrite {
  line: number;
  before: string;
  after: string;
}

export interface FileMigrationResult {
  filePath: string;
  rewrites: MigrationRewrite[];
  updated: boolean;
  addedImport: string | null;
  removedImport: string | null;
}

const CALL_RE =
  /^(\s*)((?:console|logger|pino|winston|bunyan)\.(log|info|warn|error|debug))\(\s*([\s\S]*)\)\s*;?\s*$/;
const LOGGER_IMPORT_RE = /^import\s+logger\s+from\s+["'](pino|winston|bunyan)["'];?\s*$/m;

export async function migrateFiles(filePaths: string[], options: MigrationOptions): Promise<FileMigrationResult[]> {
  return Promise.all(filePaths.map((filePath) => migrateFile(filePath, options)));
}

export async function migrateFile(filePath: string, options: MigrationOptions): Promise<FileMigrationResult> {
  const source = await readFile(filePath, "utf8");
  const lines = source.split(/\r?\n/);
  const rewrites: MigrationRewrite[] = [];

  const nextLines = lines.map((line, index) => {
    const rewritten = rewriteLine(line, options.target);
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

  let nextSource = nextLines.join("\n");
  let addedImport: string | null = null;
  let removedImport: string | null = null;

  if (options.target === "console") {
    const importMatch = nextSource.match(LOGGER_IMPORT_RE);
    if (importMatch && !/\blogger\.(?:info|warn|error|debug)\s*\(/.test(nextSource)) {
      removedImport = importMatch[0].trim();
      nextSource = nextSource.replace(`${importMatch[0]}\n`, "").replace(importMatch[0], "");
    }
  } else if (rewrites.length > 0 && !LOGGER_IMPORT_RE.test(nextSource)) {
    addedImport = `import logger from "${options.target}";`;
    nextSource = insertImport(nextSource, addedImport);
  }

  const updated = rewrites.length > 0 || addedImport !== null || removedImport !== null;
  if (updated && !options.dryRun) {
    await writeFile(filePath, nextSource, "utf8");
  }

  return { filePath, rewrites, updated, addedImport, removedImport };
}

function rewriteLine(line: string, target: MigrationTarget): string | null {
  const match = line.match(CALL_RE);
  if (!match) {
    return null;
  }

  const [, indent, , method, args] = match;
  const detection = classifyLogCall(line);
  if (!detection || detection.style === "unknown") {
    return null;
  }

  const nextCallee = formatCallee(method, target);

  if (detection.style === "structured") {
    return `${indent}${nextCallee}(${args.trim()})`;
  }

  if (detection.style === "plain-string") {
    return target === "console"
      ? `${indent}${nextCallee}(${args.trim()})`
      : `${indent}${nextCallee}({ msg: ${args.trim()} })`;
  }

  if (detection.style === "template-literal") {
    return target === "console"
      ? `${indent}${nextCallee}(${args.trim()})`
      : `${indent}${nextCallee}({ msg: ${args.trim()} })`;
  }

  if (detection.style === "raw-dump") {
    const expression = args.trim();
    return target === "console"
      ? `${indent}${nextCallee}(${expression})`
      : `${indent}${nextCallee}({ msg: ${JSON.stringify(defaultMessage(method))}, ${toObjectProperty(expression, 1)} })`;
  }

  if (detection.style === "string-concat") {
    const parts = splitTopLevelArgs(args);
    if (parts.length < 2 || !isStringLiteral(parts[0]!)) {
      return null;
    }

    const label = stripTrailingColon(unquote(parts[0]!));
    if (target === "console") {
      return `${indent}${nextCallee}(${parts.map((part) => part.trim()).join(", ")})`;
    }

    const properties = parts.slice(1).map((part, index) => toObjectProperty(part, index + 1)).join(", ");
    return `${indent}${nextCallee}({ msg: ${JSON.stringify(label)}, ${properties} })`;
  }

  return null;
}

function formatCallee(method: string, target: MigrationTarget): string {
  if (target === "console") {
    return `console.${method === "log" ? "log" : method}`;
  }

  return `logger.${method === "log" ? "info" : method}`;
}

function defaultMessage(method: string): string {
  return method === "error" ? "error" : method === "warn" ? "warning" : "log";
}

function toObjectProperty(expression: string, index: number): string {
  const trimmed = expression.trim();
  if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) {
    return trimmed;
  }

  return `value${index}: ${trimmed}`;
}

function stripTrailingColon(value: string): string {
  return value.trim().replace(/:\s*$/, "");
}

function isStringLiteral(value: string): boolean {
  return /^(['"])[\s\S]*\1$/.test(value.trim());
}

function unquote(value: string): string {
  const trimmed = value.trim();
  return trimmed.slice(1, -1);
}

function splitTopLevelArgs(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;
  let depth = 0;

  for (const char of value) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (quote) {
      current += char;
      if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      current += char;
      continue;
    }

    if (char === "(" || char === "{" || char === "[") {
      depth += 1;
      current += char;
      continue;
    }

    if (char === ")" || char === "}" || char === "]") {
      depth = Math.max(0, depth - 1);
      current += char;
      continue;
    }

    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function insertImport(source: string, importStatement: string): string {
  const lines = source.split("\n");
  let importIndex = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index]?.startsWith("import ")) {
      importIndex = index;
      break;
    }
  }

  if (importIndex >= 0) {
    lines.splice(importIndex + 1, 0, importStatement);
    return lines.join("\n");
  }

  return `${importStatement}\n${source}`;
}
