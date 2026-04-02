[![npm](https://img.shields.io/npm/v/log-shape)](https://www.npmjs.com/package/log-shape) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

# log-shape

`log-shape` is a TypeScript CLI that scans JS/TS source files and highlights inconsistent logging patterns. It uses static regex analysis to classify `console.*`, `logger.*`, `pino.*`, and `winston.*` calls, then reports mixed styles and distribution across the codebase.

## Install

```bash
pnpm add -D log-shape
```

Or run locally from this repo:

```bash
pnpm install
pnpm build
node dist/index.js src/
```

## Usage

```bash
log-shape <path> [options]
```

Options:

- `--json` JSON output
- `--no-fail` Don't exit with status code `1` on inconsistent files
- `--ext <exts>` Comma-separated extensions to scan, default: `.ts,.js,.tsx,.jsx`
- `--ignore <pat>` Comma-separated glob patterns to ignore, default: `node_modules,dist,test`
- `--config <path>` Load `.logshaperc` JSON config from the current working directory or a custom path
- `--fix` Rewrite supported `console.*` calls to a consistent target style
- `--target <style>` Rewrite target: `structured` or `template`, default: `structured`
- `--dry-run` Preview rewrites without modifying files
- `--suggest` Show pino/winston migration snippets

Example:

```bash
log-shape src/ --suggest
```

Fix mode example:

```bash
log-shape src/ --fix --target structured --dry-run
```

## What It Detects

Each supported log call is classified into one of these styles:

- `structured` `logger.info({ msg: "ok" })`
- `string-concat` `console.log("user:", user)`
- `template-literal` `` console.log(`token=${token}`) ``
- `raw-dump` `console.log(obj)`
- `plain-string` `console.log("simple message")`

Files with more than two distinct styles are flagged as inconsistent.

You can tighten that rule with config by setting `maxMixedStyles`, or explicitly allow only certain styles with `allowStyles`.

## Config

`log-shape` automatically loads `.logshaperc` from the current working directory when present. You can also point at a specific file with `--config`.

Example:

```json
{
  "logger": "pino",
  "allowStyles": ["structured"],
  "ignoreFiles": ["src/legacy/**"],
  "maxMixedStyles": 1
}
```

Fields:

- `logger`: logger family to emit during `--fix` rewrites. `pino` and `winston` emit `logger.info(...)` / `logger.error(...)`; `console` keeps `console.*(...)`
- `allowStyles`: styles considered acceptable during reporting
- `ignoreFiles`: additional glob patterns to skip during scan/fix
- `maxMixedStyles`: maximum distinct styles allowed per file before it is flagged

## How It Works

`log-shape` uses line-based static regex analysis. It does not execute code or build a full AST. This keeps the CLI fast and simple, but means it is intentionally best-effort for common single-line logging patterns.

## Migration Guide

If mixed styles are detected, move toward structured logging:

### Pino

```ts
import pino from "pino";

const logger = pino();
logger.info({ msg: "starting", port });
logger.error({ msg: "db failed", err });
```

### Winston

```ts
import winston from "winston";

const logger = winston.createLogger({
  transports: [new winston.transports.Console()]
});

logger.info({ msg: "starting", port });
logger.error({ msg: "db failed", err });
```

## Development

```bash
pnpm install
pnpm build
pnpm test
```
