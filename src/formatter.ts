import chalk from "chalk";
import path from "node:path";
import type { Report } from "./reporter.js";

const STYLE_LABELS: Record<string, string> = {
  structured: "Structured JSON  (logger.*/pino/winston)",
  "string-concat": "String concat    (console.log(\"x:\", y))",
  "template-literal": "Template literal (console.log(`x=${y}`))",
  "raw-dump": "Raw object dump  (console.log(obj))"
};

const STYLE_NOTES: Record<string, string> = {
  structured: "structured logging",
  "string-concat": "string concat style",
  "template-literal": "template literal style",
  "raw-dump": "raw object dump (not structured)",
  "plain-string": "plain string",
  unknown: "unclassified"
};

export function formatReport(report: Report, rootPath: string, includeSuggestions: boolean): string {
  const lines: string[] = [];
  lines.push(`Analyzing ${report.analyzedFiles} files...`);
  lines.push("");

  if (report.flaggedFiles.length > 0) {
    lines.push(chalk.red("Inconsistencies found:"));
    lines.push("");

    for (const issue of report.flaggedFiles) {
      for (const call of issue.calls) {
        const displayPath = toDisplayPath(rootPath, call.filePath);
        const location = `${displayPath}:${call.line}`.padEnd(18);
        const suffix = issue.disallowedCalls.includes(call) ? " (disallowed by config)" : "";
        lines.push(`${location} ${call.code} ${chalk.dim("←")} ${STYLE_NOTES[call.style]}${suffix}`);
      }
    }
  } else {
    lines.push(chalk.green("No inconsistent files found."));
  }

  lines.push("");
  lines.push("Log format distribution:");
  for (const entry of report.distribution) {
    const label = STYLE_LABELS[entry.style] ?? entry.style;
    lines.push(`  ${label}: ${String(entry.count).padStart(2)} calls (${entry.percentage}%)`);
  }

  if (report.hasMixedStyles) {
    lines.push("");
    lines.push(chalk.yellow("Mixed logging styles detected. Recommend: standardize to structured logging."));
    if (report.dominantStyle && report.dominantStyle.count > 0) {
      lines.push(
        `Dominant style: ${report.dominantStyle.style} (${report.dominantStyle.percentage}%) ` +
          "consider migrating to pino or winston."
      );
    }
  }

  if (report.allowedStyles.length < 6) {
    lines.push("");
    lines.push(`Allowed styles: ${report.allowedStyles.join(", ")}`);
  }

  if (includeSuggestions) {
    lines.push("");
    lines.push("Migration suggestions:");
    lines.push("  pino:    const logger = pino(); logger.info({ msg: \"starting\", port });");
    lines.push("  winston: logger.info({ msg: \"starting\", port });");
  }

  return lines.join("\n");
}

export function formatJson(report: Report, rootPath: string): string {
  return JSON.stringify(
    {
      analyzedFiles: report.analyzedFiles,
      hasMixedStyles: report.hasMixedStyles,
      flaggedFiles: report.flaggedFiles.map((issue) => ({
        filePath: toDisplayPath(rootPath, issue.filePath),
        styles: issue.styles,
        disallowedCalls: issue.disallowedCalls.map((call) => ({
          line: call.line,
          callee: call.callee,
          style: call.style,
          code: call.code
        })),
        calls: issue.calls.map((call) => ({
          line: call.line,
          callee: call.callee,
          style: call.style,
          code: call.code
        }))
      })),
      distribution: report.distribution,
      dominantStyle: report.dominantStyle,
      allowedStyles: report.allowedStyles,
      maxMixedStyles: report.maxMixedStyles
    },
    null,
    2
  );
}

function toDisplayPath(rootPath: string, filePath: string): string {
  const relative = path.relative(rootPath, filePath);
  return relative || path.basename(filePath);
}
