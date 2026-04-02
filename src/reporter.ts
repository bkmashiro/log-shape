import type { LogCall, ScanOptions } from "./scanner.js";

export interface Report {
  analyzedFiles: number;
  calls: LogCall[];
  flaggedFiles: FileIssue[];
  distribution: DistributionEntry[];
  dominantStyle: DistributionEntry | null;
  hasMixedStyles: boolean;
  options: ScanOptions;
}

export interface FileIssue {
  filePath: string;
  styles: string[];
  calls: LogCall[];
}

export interface DistributionEntry {
  style: string;
  count: number;
  percentage: number;
}

const REPORTABLE_STYLES = [
  "structured",
  "string-concat",
  "template-literal",
  "raw-dump"
] as const;

export function createReport(calls: LogCall[], analyzedFiles: number, options: ScanOptions): Report {
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
    if (styles.length <= 2) {
      return [];
    }

    return [
      {
        filePath,
        styles,
        calls: fileCalls
      }
    ];
  });

  return {
    analyzedFiles,
    calls,
    flaggedFiles,
    distribution,
    dominantStyle,
    hasMixedStyles: flaggedFiles.length > 0,
    options
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
