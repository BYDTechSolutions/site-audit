/*
 * The CLI, as a function: arguments and I/O in, exit code out. `cli.ts` wires
 * it to the real process; tests call it directly.
 */
import { writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { audit, normalizeUrl } from './audit.js';
import { SiteAuditError } from './errors.js';
import { isLocalDevHost } from './net/ip.js';
import { resolveHost } from './node.js';
import { counts } from './render/common.js';
import { FORMATS, formatReport, type ReportFormat } from './render/index.js';
import { AREAS, type Area, type AuditOptions, type Priority } from './types.js';
import { VERSION } from './version.js';

/** What the CLI reads from and writes to. */
export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: Record<string, string | undefined>;
  stdoutIsTTY: boolean;
  stderrIsTTY: boolean;
  columns?: number;
  writeFile?: (path: string, data: string) => Promise<void>;
  /** Overrides for the audit (tests inject a fetch). */
  auditOptions?: Partial<AuditOptions>;
}

export const HELP = `Usage: site-audit <url> [options]

Audits one page: indexability, meta & link previews, structured data, AI
crawler access, robots.txt & sitemaps, llms.txt, speed, accessibility,
security headers, installed tags and broken links. Prints a fix list grouped
into Fix now / Should fix / Nice to have. No sign-up, no config, no score.

Examples:
  npx @bydtech/site-audit https://example.com
  npx @bydtech/site-audit example.com --format html --out report.html
  npx @bydtech/site-audit http://localhost:3000 --no-psi
  npx @bydtech/site-audit https://example.com --fail-on fix-now   # for CI

Options:
  -f, --format <fmt>     text (default), json, md or html (one self-contained file)
  -o, --out <file>       write the report to a file (format taken from .json/.md/.html)
      --psi-key <key>    PageSpeed Insights API key (or set PSI_API_KEY)
      --no-psi           skip PageSpeed Insights (no speed or accessibility data)
      --desktop          also run PageSpeed Insights for desktop (mobile always runs)
      --only <areas>     comma-separated areas: ${AREAS.join(', ')}
      --fail-on <level>  exit 1 if any finding is at this level or above: fix-now or should-fix
      --max-links <n>    most links to check on the page (default 100)
      --timeout <ms>     timeout per request in milliseconds (default 15000)
      --no-probe         skip the one-request-per-AI-crawler user-agent probe
      --no-color         plain text output (also honors NO_COLOR)
  -q, --quiet            no progress messages
  -h, --help             show this help
  -v, --version          show the version

Exit codes: 0 done, 1 --fail-on threshold met, 2 bad usage or the page could not be fetched.
`;

const FAIL_LEVELS: Record<string, Priority[]> = {
  'fix-now': ['fix-now'],
  'should-fix': ['fix-now', 'should-fix'],
};

/** Runs the CLI. Returns the exit code. */
export async function main(argv: string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        format: { type: 'string', short: 'f' },
        out: { type: 'string', short: 'o' },
        'psi-key': { type: 'string' },
        'no-psi': { type: 'boolean' },
        desktop: { type: 'boolean' },
        only: { type: 'string' },
        'fail-on': { type: 'string' },
        'max-links': { type: 'string' },
        timeout: { type: 'string' },
        'no-probe': { type: 'boolean' },
        'no-color': { type: 'boolean' },
        quiet: { type: 'boolean', short: 'q' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (error) {
    io.stderr(`site-audit: ${(error as Error).message}\nRun site-audit --help for usage.\n`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    io.stdout(HELP);
    return 0;
  }
  if (values.version) {
    io.stdout(`${VERSION}\n`);
    return 0;
  }
  const usage = (message: string) => {
    io.stderr(`site-audit: ${message}\nRun site-audit --help for usage.\n`);
    return 2;
  };
  if (positionals.length !== 1) return usage(positionals.length ? 'Give exactly one URL.' : 'Give a URL to audit, e.g. site-audit https://example.com');

  let format: ReportFormat = 'text';
  if (values.format) {
    if (!FORMATS.includes(values.format as ReportFormat)) return usage(`--format must be one of ${FORMATS.join(', ')}.`);
    format = values.format as ReportFormat;
  } else if (values.out) {
    const ext = extname(values.out).toLowerCase();
    format = ext === '.json' ? 'json' : ext === '.md' || ext === '.markdown' ? 'md' : ext === '.html' || ext === '.htm' ? 'html' : 'text';
  }

  let only: Area[] | undefined;
  if (values.only) {
    only = values.only.split(',').map((s) => s.trim()).filter(Boolean) as Area[];
    const unknown = only.filter((a) => !AREAS.includes(a));
    if (unknown.length) return usage(`Unknown area(s): ${unknown.join(', ')}. Areas: ${AREAS.join(', ')}.`);
  }
  const failOn = values['fail-on'];
  if (failOn && !FAIL_LEVELS[failOn]) return usage('--fail-on must be fix-now or should-fix.');
  const intOption = (name: string, value: string | undefined, min: number): number | undefined | null => {
    if (value === undefined) return undefined;
    const n = Number(value);
    return Number.isInteger(n) && n >= min ? n : null;
  };
  const maxLinks = intOption('max-links', values['max-links'], 0);
  if (maxLinks === null) return usage('--max-links must be a whole number, 0 or more.');
  const timeoutMs = intOption('timeout', values.timeout, 1000);
  if (timeoutMs === null) return usage('--timeout must be a whole number of milliseconds, 1000 or more.');

  let target: string;
  try {
    target = new URL(normalizeUrl(positionals[0] as string)).href;
  } catch {
    return usage(`Not a valid URL: ${positionals[0]}`);
  }
  const local = isLocalDevHost(new URL(target).hostname);

  const showProgress = io.stderrIsTTY && !values.quiet;
  let lastLen = 0;
  const progress = (message: string) => {
    if (!showProgress) return;
    const line = `  ${message}`.slice(0, Math.max(20, (io.columns ?? 80) - 1));
    io.stderr(`\r${line}${' '.repeat(Math.max(0, lastLen - line.length))}`);
    lastLen = line.length;
  };
  const clearProgress = () => {
    if (showProgress && lastLen) io.stderr(`\r${' '.repeat(lastLen)}\r`);
    lastLen = 0;
  };

  const options: AuditOptions = {
    allowPrivate: local,
    resolveHost,
    psi: !values['no-psi'],
    psiKey: values['psi-key'] || io.env.PSI_API_KEY || undefined,
    strategies: values.desktop ? ['mobile', 'desktop'] : ['mobile'],
    only,
    maxLinks,
    timeoutMs,
    probeCrawlers: !values['no-probe'],
    onProgress: progress,
    ...io.auditOptions,
  };

  let report;
  try {
    report = await audit(target, options);
  } catch (error) {
    clearProgress();
    if (error instanceof SiteAuditError) {
      io.stderr(`site-audit: ${error.message}\n`);
      return 2;
    }
    io.stderr(`site-audit: unexpected error: ${(error as Error).stack ?? error}\n`);
    return 2;
  }
  clearProgress();

  const color = format === 'text' && !values.out && io.stdoutIsTTY && !values['no-color'] && !io.env.NO_COLOR;
  const output = formatReport(report, format, { color, width: Math.min(110, io.columns ?? 100) });
  const c = counts(report);
  if (values.out) {
    const path = resolve(values.out);
    try {
      await (io.writeFile ?? ((p: string, d: string) => writeFile(p, d, 'utf8')))(path, output);
    } catch (error) {
      io.stderr(`site-audit: could not write ${path}: ${(error as Error).message}\n`);
      return 2;
    }
    io.stdout(`Wrote ${format} report to ${path}: ${c['fix-now']} fix now, ${c['should-fix']} should fix, ${c['nice-to-have']} nice to have, ${report.passed.length} passed.\n`);
  } else {
    io.stdout(output);
  }

  if (failOn) {
    const levels = FAIL_LEVELS[failOn] as Priority[];
    const hits = report.findings.filter((f) => levels.includes(f.priority)).length;
    if (hits) {
      io.stderr(`site-audit: ${hits} finding(s) at ${failOn}${failOn === 'should-fix' ? ' or above' : ''} (--fail-on).\n`);
      return 1;
    }
  }
  return 0;
}
