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

export function formatTextReport(report: Report, rootPath: string, includeSuggestions: boolean): string {
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

  lines.push("");
  lines.push(
    `Score: ${report.summary.score}/100 ` +
      `(mixed styles penalty: ${report.summary.mixedStylesPenalty}, raw dump penalty: ${report.summary.rawDumpPenalty})`
  );

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

export function formatJsonReport(report: Report, rootPath: string): string {
  return JSON.stringify(
    {
      summary: {
        ...report.summary,
        inconsistentFiles: report.summary.inconsistentFiles.map((filePath) => toDisplayPath(rootPath, filePath))
      },
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

export function formatHtmlReport(report: Report, rootPath: string): string {
  const distributionItems = report.distribution
    .map(
      (entry) =>
        `<tr><td>${escapeHtml(entry.style)}</td><td>${entry.count}</td><td>${entry.percentage}%</td></tr>`
    )
    .join("");

  const issueItems =
    report.flaggedFiles.length === 0
      ? `<p class="empty">No inconsistent files found.</p>`
      : report.flaggedFiles
          .map((issue) => {
            const callItems = issue.calls
              .map(
                (call) =>
                  `<li><code>${escapeHtml(toDisplayPath(rootPath, call.filePath))}:${call.line}</code> ` +
                  `<span>${escapeHtml(call.style)}</span> <pre>${escapeHtml(call.code)}</pre></li>`
              )
              .join("");
            return `<section><h3>${escapeHtml(toDisplayPath(rootPath, issue.filePath))}</h3><ul>${callItems}</ul></section>`;
          })
          .join("");

  const inconsistentFiles = report.summary.inconsistentFiles
    .map((filePath) => `<li>${escapeHtml(toDisplayPath(rootPath, filePath))}</li>`)
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>log-shape report</title>
  <style>
    :root { color-scheme: light; --bg: #f3efe6; --card: #fffdf8; --ink: #1d1a16; --muted: #6a6258; --accent: #0b6e4f; --warn: #a63d40; --line: #d8cfbf; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Georgia, "Iowan Old Style", serif; background: radial-gradient(circle at top, #fff9ec, var(--bg)); color: var(--ink); }
    main { max-width: 960px; margin: 0 auto; padding: 40px 20px 56px; }
    h1, h2, h3 { margin: 0 0 12px; }
    p { color: var(--muted); }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 24px 0; }
    .card, section { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 16px; box-shadow: 0 10px 30px rgba(29, 26, 22, 0.06); }
    .metric { font-size: 2rem; color: var(--accent); }
    table { width: 100%; border-collapse: collapse; background: var(--card); border-radius: 16px; overflow: hidden; }
    th, td { padding: 12px; border-bottom: 1px solid var(--line); text-align: left; }
    ul { padding-left: 20px; }
    code, pre { font-family: "SFMono-Regular", Consolas, monospace; }
    pre { white-space: pre-wrap; margin: 8px 0 0; color: var(--warn); }
    .empty { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 16px; }
  </style>
</head>
<body>
  <main>
    <h1>log-shape report</h1>
    <p>${escapeHtml(`Analyzed ${report.analyzedFiles} files. Score ${report.summary.score}/100.`)}</p>
    <div class="grid">
      <div class="card"><div class="metric">${report.summary.totalCalls}</div><div>Total calls</div></div>
      <div class="card"><div class="metric">${report.summary.score}</div><div>Score</div></div>
      <div class="card"><div class="metric">${report.summary.mixedStylesPenalty}</div><div>Mixed styles penalty</div></div>
      <div class="card"><div class="metric">${report.summary.rawDumpPenalty}</div><div>Raw dump penalty</div></div>
    </div>
    <h2>Distribution</h2>
    <table>
      <thead><tr><th>Style</th><th>Calls</th><th>Share</th></tr></thead>
      <tbody>${distributionItems}</tbody>
    </table>
    <h2>Inconsistent files</h2>
    ${inconsistentFiles ? `<ul>${inconsistentFiles}</ul>` : `<p class="empty">None</p>`}
    <h2>Details</h2>
    ${issueItems}
  </main>
</body>
</html>`;
}

function toDisplayPath(rootPath: string, filePath: string): string {
  const relative = path.relative(rootPath, filePath);
  return relative || path.basename(filePath);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
