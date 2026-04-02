export type LogStyle =
  | "structured"
  | "string-concat"
  | "template-literal"
  | "raw-dump"
  | "plain-string"
  | "unknown";

export interface DetectionResult {
  callee: string;
  style: LogStyle;
}

const LOGGER_CALL_RE = /\b(?<callee>(?:console|logger|pino|winston|bunyan)\.[A-Za-z_$][\w$]*)\s*\((?<args>.*)\)\s*;?\s*$/;

export function classifyLogCall(sourceLine: string): DetectionResult | null {
  const trimmed = sourceLine.trim();
  const match = trimmed.match(LOGGER_CALL_RE);

  if (!match?.groups) {
    return null;
  }

  const callee = match.groups.callee;
  const args = match.groups.args.trim();
  const style = classifyArgs(callee, args);
  return { callee, style };
}

function classifyArgs(callee: string, args: string): LogStyle {
  if (!args) {
    return "unknown";
  }

  if (isStructuredLogger(callee, args)) {
    return "structured";
  }

  if (isTemplateLiteral(args)) {
    return "template-literal";
  }

  if (isStringConcat(args)) {
    return "string-concat";
  }

  if (isPlainString(args)) {
    return "plain-string";
  }

  if (isRawDump(args)) {
    return "raw-dump";
  }

  return "unknown";
}

function isStructuredLogger(callee: string, args: string): boolean {
  return /^(?:logger|pino|winston|bunyan)\./.test(callee) && /^\{[\s\S]*\}$/.test(args);
}

function isTemplateLiteral(args: string): boolean {
  return /^`[\s\S]*`$/.test(args);
}

function isStringConcat(args: string): boolean {
  return /^(['"])(?:(?!\1)[\s\S])*?\1\s*,\s*[\s\S]+$/.test(args);
}

function isPlainString(args: string): boolean {
  return /^(['"])(?:(?!\1)[\s\S])*?\1$/.test(args);
}

function isRawDump(args: string): boolean {
  if (args.includes(",")) {
    return false;
  }

  return !/^['"`]/.test(args);
}
