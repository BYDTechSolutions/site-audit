import { capList, type AuditContext } from '../context.js';
import { SiteAuditError } from '../errors.js';
import { mapLimit, safeFetch } from '../net/fetcher.js';
import type { LinkSummary } from '../types.js';

const AREA = 'links' as const;
/** Most distinct hosts whose robots.txt we read for link checks; links to further hosts are skipped. */
const MAX_HOSTS = 30;

type Outcome =
  | { kind: 'ok'; status: number }
  | { kind: 'broken'; status: number }
  | { kind: 'server'; status: number }
  | { kind: 'unverified'; status: number }
  | { kind: 'error'; message: string }
  | { kind: 'skipped'; reason: string };

/** Absolute http(s) link targets on the page, without fragments, deduplicated, in page order. */
export function pageLinks(ctx: Pick<AuditContext, 'doc' | 'page'>): string[] {
  const baseHref = ctx.doc.tags.find((t) => t.name === 'base' && t.attrs.href)?.attrs.href;
  let base = ctx.page.url;
  try {
    if (baseHref) base = new URL(baseHref, ctx.page.url).href;
  } catch {
    // keep the page URL
  }
  const self = new URL(ctx.page.url);
  self.hash = '';
  const seen = new Set<string>();
  for (const t of ctx.doc.tags) {
    if ((t.name !== 'a' && t.name !== 'area') || !t.attrs.href) continue;
    const href = t.attrs.href.trim();
    if (!href || href.startsWith('#') || /^(mailto|tel|javascript|data|sms):/i.test(href)) continue;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
    url.hash = '';
    if (url.href === self.href) continue;
    seen.add(url.href);
  }
  return [...seen];
}

function classify(status: number): Outcome {
  if (status >= 200 && status < 400) return { kind: 'ok', status };
  if (status === 401 || status === 403 || status === 429) return { kind: 'unverified', status };
  if (status >= 500) return { kind: 'server', status };
  return { kind: 'broken', status };
}

/** Checks every link on the page (capped): HEAD first, then GET when HEAD fails. */
export async function checkLinks(ctx: AuditContext): Promise<void> {
  if (!ctx.isHtml) return;
  const all = pageLinks(ctx);
  const links = all.slice(0, ctx.options.maxLinks);
  const hosts = new Set<string>();
  ctx.progress(`Checking ${links.length} link(s)`);

  const outcomes = await mapLimit(links, ctx.options.linkConcurrency, async (link): Promise<Outcome> => {
    const origin = new URL(link).origin;
    if (!hosts.has(origin)) {
      if (hosts.size >= MAX_HOSTS) return { kind: 'skipped', reason: 'host cap' };
      hosts.add(origin);
    }
    if (!(await ctx.mayFetch(link))) return { kind: 'skipped', reason: 'robots.txt' };
    try {
      const head = await safeFetch(ctx.net, link, { method: 'HEAD', timeoutMs: 10_000 });
      if (head.status < 400) return classify(head.status);
      const get = await safeFetch(ctx.net, link, { timeoutMs: 10_000, maxBytes: 16_384 });
      return classify(get.status);
    } catch (error) {
      if (error instanceof SiteAuditError && error.code === 'BLOCKED') return { kind: 'skipped', reason: 'private address' };
      return { kind: 'error', message: (error as Error).message };
    }
  });

  const summary: LinkSummary = { found: all.length, checked: 0, ok: 0, broken: 0, unverified: 0, skipped: 0, capped: all.length > links.length };
  const broken: string[] = [];
  const unreachable: string[] = [];
  const skippedReasons = new Map<string, number>();
  outcomes.forEach((o, i) => {
    const link = links[i] as string;
    if (o.kind === 'skipped') {
      summary.skipped++;
      skippedReasons.set(o.reason, (skippedReasons.get(o.reason) ?? 0) + 1);
      return;
    }
    summary.checked++;
    if (o.kind === 'ok') summary.ok++;
    else if (o.kind === 'unverified') summary.unverified++;
    else if (o.kind === 'broken') {
      summary.broken++;
      broken.push(`${o.status} ${link}`);
    } else if (o.kind === 'server') {
      summary.broken++;
      unreachable.push(`${o.status} ${link}`);
    } else {
      summary.broken++;
      unreachable.push(`${link}: ${o.message}`);
    }
  });
  ctx.data.links = summary;

  if (summary.capped) ctx.note(AREA, `The page has ${all.length} links; checked the first ${links.length} (--max-links).`);
  for (const [reason, n] of skippedReasons) {
    const why = reason === 'robots.txt' ? 'robots.txt disallows this tool' : reason === 'private address' ? 'they point at private addresses' : `more than ${MAX_HOSTS} hosts are linked`;
    ctx.note(AREA, `Skipped ${n} link(s) because ${why}.`);
  }
  if (summary.unverified) ctx.note(AREA, `${summary.unverified} link(s) answered 401, 403 or 429: the site refused an automated check, which says nothing about whether the link works.`);

  const source = { title: 'MDN: HTTP response status codes', url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status' };
  if (broken.length) {
    ctx.add({
      id: `${AREA}/broken`, area: AREA, priority: 'should-fix', label: 'measured',
      title: `${broken.length} broken link(s) on the page`,
      observed: `${broken.length} of ${summary.checked} checked links answered with a client error (404, 410, ...).`,
      why: 'Visitors who click them hit a dead end, and crawlers waste visits on pages that do not exist.',
      fix: 'Update each link to the current URL, or remove it.',
      source,
      details: capList(broken, 20),
    });
  }
  if (unreachable.length) {
    ctx.add({
      id: `${AREA}/unreachable`, area: AREA, priority: 'nice-to-have', label: 'measured',
      title: `${unreachable.length} link(s) errored or could not be reached`,
      observed: 'Server errors (5xx), timeouts or connection failures. These can be temporary.',
      why: 'If they persist, visitors who click them get an error page.',
      fix: 'Open each one; if it stays down, update or remove the link.',
      source,
      details: capList(unreachable, 20),
    });
  }
  if (!broken.length && !unreachable.length && summary.checked) {
    ctx.pass(`${AREA}/broken`, AREA, `${summary.ok} link(s) checked, none broken`);
  }
}
