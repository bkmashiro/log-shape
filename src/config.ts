import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LogStyle } from "./detector.js";

export type FixLogger = "pino" | "winston" | "console";

export interface LogShapeConfig {
  logger: FixLogger;
  allowStyles: LogStyle[];
  ignoreFiles: string[];
  maxMixedStyles: number;
}

export interface LoadedConfig {
  path: string;
  config: LogShapeConfig;
}

export const DEFAULT_CONFIG: LogShapeConfig = {
  logger: "pino",
  allowStyles: ["structured", "string-concat", "template-literal", "raw-dump", "plain-string", "unknown"],
  ignoreFiles: [],
  maxMixedStyles: 2
};

export async function loadConfig(configPath?: string): Promise<LoadedConfig | null> {
  const resolvedPath = path.resolve(configPath ?? ".logshaperc");

  try {
    const raw = await readFile(resolvedPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<LogShapeConfig>;
    return {
      path: resolvedPath,
      config: normalizeConfig(parsed)
    };
  } catch (error) {
    if (isMissingFile(error) && !configPath) {
      return null;
    }

    throw error;
  }
}

function normalizeConfig(input: Partial<LogShapeConfig>): LogShapeConfig {
  return {
    logger: isFixLogger(input.logger) ? input.logger : DEFAULT_CONFIG.logger,
    allowStyles: normalizeStyles(input.allowStyles),
    ignoreFiles: Array.isArray(input.ignoreFiles) ? input.ignoreFiles.filter(isNonEmptyString) : DEFAULT_CONFIG.ignoreFiles,
    maxMixedStyles:
      typeof input.maxMixedStyles === "number" && Number.isInteger(input.maxMixedStyles) && input.maxMixedStyles >= 0
        ? input.maxMixedStyles
        : DEFAULT_CONFIG.maxMixedStyles
  };
}

function normalizeStyles(styles: unknown): LogStyle[] {
  if (!Array.isArray(styles)) {
    return DEFAULT_CONFIG.allowStyles;
  }

  const normalized = styles.filter(isLogStyle);
  return normalized.length > 0 ? normalized : DEFAULT_CONFIG.allowStyles;
}

function isFixLogger(value: unknown): value is FixLogger {
  return value === "pino" || value === "winston" || value === "console";
}

function isLogStyle(value: unknown): value is LogStyle {
  return (
    value === "structured" ||
    value === "string-concat" ||
    value === "template-literal" ||
    value === "raw-dump" ||
    value === "plain-string" ||
    value === "unknown"
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
