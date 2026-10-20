import { checkAiCrawlers } from './checks/ai-crawlers.js';
import { checkIndexability } from './checks/indexability.js';
import { checkLinks } from './checks/links.js';
import { checkLlmsTxt } from './checks/llms-txt.js';
import { checkMeta } from './checks/meta.js';
import { checkPsi } from './checks/psi.js';
import { checkRobotsSitemaps } from './checks/robots-sitemaps.js';
import { checkSecurity } from './checks/security.js';
import { checkStructuredData } from './checks/structured-data.js';
import { checkTags } from './checks/tags.js';
import { createAuditContext, type AuditContext, type CheckOptions } from './context.js';
import { parsePage, type PageDoc } from './html.js';
import { createContext, decodeText, parseTarget, safeFetch } from './net/fetcher.js';
import { isLocalDevHost } from './net/ip.js';
import { AREAS, PRIORITIES, type Area, type AuditOptions, type Report } from './types.js';
import { PRODUCT_TOKEN, REPO_URL, VERSION } from './version.js';

/**
 * Adds a scheme when the input has none: `http://` for `localhost`,
 * `127.0.0.1` and `[::1]` (with or without a port), `https://` otherwise.
 * `example.com` becomes `https://example.com/`.
 */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  const host = trimmed.split(/[/?#]/)[0] ?? '';
  const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.replace(/:\d+$/, '');
  return `${isLocalDevHost(hostname) ? 'http' : 'https'}://${trimmed}`;
}

const CHECKS: { area: Area; run: (ctx: AuditContext) => Promise<void> }[] = [
  { area: 'indexability', run: checkIndexability },
  { area: 'meta', run: checkMeta },
  { area: 'structured-data', run: checkStructuredData },
  { area: 'robots-sitemaps', run: checkRobotsSitemaps },
  { area: 'llms-txt', run: checkLlmsTxt },
  { area: 'security', run: checkSecurity },
  { area: 'tags', run: checkTags },
  { area: 'ai-crawlers', run: checkAiCrawlers },
  { area: 'links', run: checkLinks },
];

/**
 * Audits one URL and returns a report: findings grouped by priority, each
 * with an evidence label, what was seen, why it matters, how to fix it and a
 * source. There is no overall score.
 *
 * Throws {@link SiteAuditError} only when the page itself cannot be fetched
 * (invalid URL, blocked private address, network failure). Everything else,
 * including a failed PageSpeed Insights call, ends up in the report.
 *
 * @example
 * ```ts
 * import { audit } from '@bydtech/site-audit';
 * const report = await audit('https://example.com', { psiKey: process.env.PSI_API_KEY });
 * console.log(report.findings.filter((f) => f.priority === 'fix-now'));
 * ```
 */
export async function audit(input: string, options: AuditOptions = {}): Promise<Report> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const url = parseTarget(normalizeUrl(input)).href;
  const areas = AREAS.filter((a) => !options.only || options.only.includes(a));
  const net = createContext({
    fetch: options.fetch,
    allowPrivate: options.allowPrivate ?? false,
    resolveHost: options.resolveHost,
    maxRedirects: options.maxRedirects,
    maxBodyBytes: options.maxBodyBytes,
    timeoutMs: options.timeoutMs,
  });
  const checkOptions: CheckOptions = {
    psi: options.psi ?? true,
    psiKey: options.psiKey || undefined,
    strategies: options.strategies?.length ? [...new Set(options.strategies)] : ['mobile'],
    maxLinks: Math.max(0, options.maxLinks ?? 100),
    linkConcurrency: Math.max(1, options.linkConcurrency ?? 4),
    psiTimeoutMs: options.psiTimeoutMs ?? 120_000,
    probeDelayMs: options.probeDelayMs ?? 250,
    probeCrawlers: options.probeCrawlers ?? true,
  };

  options.onProgress?.(`Fetching ${url}`);
  const page = await safeFetch(net, url, { accept: 'text/html,application/xhtml+xml,*/*;q=0.8' });
  const text = decodeText(page.body, page.contentType);
  const isHtml = page.contentType.includes('html') || (!page.contentType && /^\s*<(!doctype html|html)/i.test(text));
  const doc: PageDoc = isHtml ? parsePage(text) : { tags: [], scripts: [], titles: [], lang: null };

  const { ctx, collected } = createAuditContext({
    net,
    options: checkOptions,
    page,
    doc,
    html: isHtml ? text : '',
    isHtml,
    onProgress: options.onProgress,
    data: {
      page: {
        requestedUrl: url,
        finalUrl: page.url,
        status: page.status,
        contentType: page.contentType,
        bytes: page.body.byteLength,
        truncated: page.truncated,
        redirects: page.redirects,
        timeMs: page.timeMs,
      },
    },
  });
  if (!isHtml) ctx.note('general', `The URL returned ${page.contentType || 'no content type'}, not HTML, so page-content checks were skipped.`);
  if (page.truncated) ctx.note('general', `The page is larger than ${net.maxBodyBytes} bytes; only the first part was read.`);

  const guarded = async (area: Area | 'general', run: () => Promise<void>) => {
    try {
      await run();
    } catch (error) {
      ctx.note(area, `This check could not finish: ${(error as Error).message}`);
    }
  };

  const wantSpeed = areas.includes('speed');
  const wantA11y = areas.includes('accessibility');
  const psi = wantSpeed || wantA11y
    ? guarded(wantSpeed ? 'speed' : 'accessibility', () => checkPsi(ctx, { speed: wantSpeed, accessibility: wantA11y }))
    : Promise.resolve();

  for (const check of CHECKS) {
    if (!areas.includes(check.area)) continue;
    ctx.progress(`Checking ${check.area}`);
    await guarded(check.area, () => check.run(ctx));
  }
  await psi;

  const order = (a: Area) => AREAS.indexOf(a);
  collected.findings.sort((a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) || order(a.area) - order(b.area));
  return {
    tool: { name: `@bydtech/${PRODUCT_TOKEN}`, version: VERSION, url: REPO_URL },
    url,
    finalUrl: page.url,
    startedAt,
    durationMs: Date.now() - started,
    areas,
    findings: collected.findings,
    passed: collected.passed,
    notes: collected.notes,
    data: ctx.data,
  };
}
