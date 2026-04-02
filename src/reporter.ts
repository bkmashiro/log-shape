import type { LogStyle } from "./detector.js";
import type { LogCall, ScanOptions } from "./scanner.js";

export interface Report {
  analyzedFiles: number;
  calls: LogCall[];
  flaggedFiles: FileIssue[];
  distribution: DistributionEntry[];
  dominantStyle: DistributionEntry | null;
  hasMixedStyles: boolean;
  options: ScanOptions;
  allowedStyles: LogStyle[];
  maxMixedStyles: number;
  summary: ReportSummary;
}

export interface ReportSummary {
  totalCalls: number;
  styles: Record<string, number>;
  inconsistentFiles: string[];
  score: number;
  mixedStylesPenalty: number;
  rawDumpPenalty: number;
}

export interface FileIssue {
  filePath: string;
  styles: string[];
  calls: LogCall[];
  disallowedCalls: LogCall[];
}

export interface DistributionEntry {
  style: string;
  count: number;
  percentage: number;
}

export const REPORTABLE_STYLES = [
  "structured",
  "string-concat",
  "template-literal",
  "raw-dump"
] as const;

export interface ReportOptions extends ScanOptions {
  allowStyles: LogStyle[];
  maxMixedStyles: number;
}

export function createReport(calls: LogCall[], analyzedFiles: number, options: ReportOptions): Report {
  const reportableCalls = calls.filter((call) =>
    REPORTABLE_STYLES.includes(call.style as (typeof REPORTABLE_STYLES)[number])
  );

  const distribution = REPORTABLE_STYLES.map((style) => {
    const count = reportableCalls.filter((call) => call.style === style).length;
    const percentage = reportableCalls.length === 0 ? 0 : Math.round((count / reportableCalls.length) * 100);
    return { style, count, percentage };
  });

  const dominantStyle = [...distribution].sort((left, right) => right.count - left.count)[0] ?? null;
  const flaggedFiles = groupByFile(calls).flatMap(([filePath, fileCalls]) => {
    const styles = [...new Set(fileCalls.map((call) => call.style).filter((style) => style !== "unknown"))];
    const disallowedCalls = fileCalls.filter((call) => !options.allowStyles.includes(call.style));
    if (styles.length <= options.maxMixedStyles && disallowedCalls.length === 0) {
      return [];
    }

    return [
      {
        filePath,
        styles,
        calls: fileCalls,
        disallowedCalls
      }
    ];
  });

  const styleCounts = Object.fromEntries(distribution.map((entry) => [entry.style, entry.count]));
  const activeStyleCount = distribution.filter((entry) => entry.count > 0).length;
  const mixedStylesPenalty = Math.max(0, activeStyleCount - 1) * 10;
  const rawDumpPenalty = Math.ceil((styleCounts["raw-dump"] ?? 0) * 1.5);
  const score = Math.max(0, 100 - mixedStylesPenalty - rawDumpPenalty);

  return {
    analyzedFiles,
    calls,
    flaggedFiles,
    distribution,
    dominantStyle,
    hasMixedStyles: flaggedFiles.length > 0,
    options,
    allowedStyles: options.allowStyles,
    maxMixedStyles: options.maxMixedStyles,
    summary: {
      totalCalls: reportableCalls.length,
      styles: styleCounts,
      inconsistentFiles: flaggedFiles.map((issue) => issue.filePath),
      score,
      mixedStylesPenalty,
      rawDumpPenalty
    }
  };
}

function groupByFile(calls: LogCall[]): Array<[string, LogCall[]]> {
  const grouped = new Map<string, LogCall[]>();

  for (const call of calls) {
    const current = grouped.get(call.filePath) ?? [];
    current.push(call);
    grouped.set(call.filePath, current);
  }

  return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));
}
