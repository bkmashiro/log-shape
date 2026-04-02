import { stat } from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";
import { classifyLogCall, type DetectionResult } from "./detector.js";

export interface ScanOptions {
  extensions: string[];
  ignore: string[];
}

export interface LogCall extends DetectionResult {
  filePath: string;
  line: number;
  code: string;
}

export interface ScanResult {
  files: string[];
  calls: LogCall[];
}

const CALL_LINE_RE = /\b(?:console|logger|pino|winston)\.[A-Za-z_$][\w$]*\s*\(.*\)\s*;?\s*$/;

export async function scanPath(targetPath: string, options: ScanOptions): Promise<ScanResult> {
  const absoluteTarget = path.resolve(targetPath);
  const targetStat = await stat(absoluteTarget);

  if (targetStat.isFile()) {
    const contents = await BunLikeFile.read(absoluteTarget);
    return {
      files: [absoluteTarget],
      calls: extractLogCallsFromText(contents, absoluteTarget)
    };
  }

  const patterns = options.extensions.map((ext) => `**/*${normalizeExtension(ext)}`);
  const files = await glob(patterns, {
    cwd: absoluteTarget,
    absolute: true,
    nodir: true,
    ignore: options.ignore.map((entry) => normalizeIgnore(entry))
  });

  const calls = await Promise.all(
    files.sort().map(async (filePath) => extractLogCallsFromText(await BunLikeFile.read(filePath), filePath))
  );

  return {
    files,
    calls: calls.flat()
  };
}

export async function resolveScanFiles(targetPath: string, options: ScanOptions): Promise<string[]> {
  const absoluteTarget = path.resolve(targetPath);
  const targetStat = await stat(absoluteTarget);

  if (targetStat.isFile()) {
    return [absoluteTarget];
  }

  const patterns = options.extensions.map((ext) => `**/*${normalizeExtension(ext)}`);
  const files = await glob(patterns, {
    cwd: absoluteTarget,
    absolute: true,
    nodir: true,
    ignore: options.ignore.map((entry) => normalizeIgnore(entry))
  });

  return files.sort();
}

export function extractLogCallsFromText(source: string, filePath: string): LogCall[] {
  return source.split(/\r?\n/).flatMap((line, index) => {
    if (!CALL_LINE_RE.test(line)) {
      return [];
    }

    const detection = classifyLogCall(line);
    if (!detection) {
      return [];
    }

    return [
      {
        ...detection,
        filePath,
        line: index + 1,
        code: line.trim()
      }
    ];
  });
}

function normalizeExtension(ext: string): string {
  return ext.startsWith(".") ? ext : `.${ext}`;
}

function normalizeIgnore(pattern: string): string {
  const trimmed = pattern.trim();
  if (!trimmed) {
    return trimmed;
  }

  if (trimmed.includes("*")) {
    return trimmed;
  }

  return `${trimmed}/**`;
}

const BunLikeFile = {
  async read(filePath: string): Promise<string> {
    const { readFile } = await import("node:fs/promises");
    return readFile(filePath, "utf8");
  }
};
