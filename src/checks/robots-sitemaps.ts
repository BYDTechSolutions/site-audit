import { capList, type AuditContext } from '../context.js';
import { SOURCES } from '../facts/sources.js';
import { decodeText, safeFetch } from '../net/fetcher.js';
import { gunzip, isGzip, isW3cDate, parseSitemap, type SitemapEntry } from '../sitemap.js';
import type { SitemapSummary } from '../types.js';

const AREA = 'robots-sitemaps' as const;
const ROBOTS_LIMIT = 500 * 1024;
const SITEMAP_MAX_URLS = 50_000;
const SITEMAP_MAX_BYTES = 52_428_800;
/** Most sitemap files read per audit (one index plus children). */
const MAX_SITEMAP_FILES = 5;

const sitemapsOrg = { title: 'sitemaps.org: Sitemaps XML format', url: 'https://www.sitemaps.org/protocol.html' };

/** robots.txt syntax and status, and the sitemaps it declares (or /sitemap.xml). */
export async function checkRobotsSitemaps(ctx: AuditContext): Promise<void> {
  const origin = ctx.pageUrl.origin;
  const robots = await ctx.robotsFor(origin);
  const summary: SitemapSummary = {
    robotsTxt: { url: robots.url, status: robots.status, bytes: robots.bytes },
    sitemaps: [],
    totalUrls: 0,
  };
  ctx.data.sitemaps = summary;

  if (robots.status === null) {
    ctx.note(AREA, `robots.txt could not be fetched: ${robots.error}`);
  } else if (robots.status >= 500 || robots.status === 429) {
    ctx.add({
      id: `${AREA}/robots-error`, area: AREA, priority: 'fix-now', label: 'measured',
      title: `robots.txt answers ${robots.status}`,
      observed: `${robots.url} returned ${robots.status}.`,
      why: robots.status === 429
        ? 'Google treats every 4xx on robots.txt as "no rules" except 429, so this answer leaves crawlers unsure what they may crawl.'
        : 'Google treats a server error on robots.txt as a reason to stop crawling the site for the first 12 hours, then falls back to a cached copy for up to 30 days.',
      fix: 'Make /robots.txt answer 200 (with your rules) or 404 (no rules).',
      source: SOURCES.googleRobots,
    });
  } else if (robots.status >= 400) {
    ctx.add({
      id: `${AREA}/robots-missing`, area: AREA, priority: 'nice-to-have', label: 'measured',
      title: 'No robots.txt',
      observed: `${robots.url} returned ${robots.status}.`,
      why: 'Google treats a missing robots.txt as "no crawl restrictions", which is fine. You only lose the standard place to point crawlers at your sitemap.',
      fix: 'Optional: add /robots.txt with a "Sitemap: https://…/sitemap.xml" line.',
      source: SOURCES.googleRobots,
    });
  } else if (robots.status >= 200 && robots.status < 300 && robots.parsed) {
    const problems: string[] = [];
    if (/^\s*<(!doctype|html)/i.test(robots.text)) {
      ctx.add({
        id: `${AREA}/robots-html`, area: AREA, priority: 'should-fix', label: 'measured',
        title: 'robots.txt returns an HTML page',
        observed: `${robots.url} answered 200 with HTML (often a single-page app's fallback route).`,
        why: 'Crawlers parse it as robots.txt anyway: nothing in it is a rule, so you have no rules and no sitemap declared, without knowing it.',
        fix: 'Serve a plain-text robots.txt, or return 404 for /robots.txt.',
        source: SOURCES.googleRobots,
      });
    } else {
      if (robots.bytes > ROBOTS_LIMIT) {
        ctx.add({
          id: `${AREA}/robots-too-large`, area: AREA, priority: 'should-fix', label: 'measured',
          title: 'robots.txt is over 500 KiB',
          observed: `${Math.round(robots.bytes / 1024)} KiB.`,
          why: 'Google ignores everything after the first 500 KiB of robots.txt.',
          fix: 'Consolidate rules (wildcards instead of one line per URL) to bring the file under the limit.',
          source: SOURCES.googleRobots,
        });
      }
      const outside = robots.parsed.issues.filter((i) => i.kind === 'rule-outside-group');
      if (outside.length) {
        ctx.add({
          id: `${AREA}/robots-rule-outside-group`, area: AREA, priority: 'should-fix', label: 'measured',
          title: 'robots.txt has rules before any User-agent line',
          observed: `${outside.length} Allow/Disallow line(s) with no group.`,
          why: 'Rules only apply inside a group that starts with User-agent; these lines are ignored.',
          fix: 'Put a "User-agent: *" (or the right agent) line above them.',
          source: SOURCES.googleRobots,
          details: capList(outside.map((i) => `line ${i.line}: ${i.text}`)),
        });
      }
      for (const i of robots.parsed.issues) {
        if (i.kind === 'syntax') problems.push(`line ${i.line}: not a "field: value" line — ${i.text}`);
        if (i.kind === 'unknown-field') problems.push(`line ${i.line}: field Google does not support — ${i.text}`);
        if (i.kind === 'crawl-delay') problems.push(`line ${i.line}: crawl-delay is ignored by Google — ${i.text}`);
      }
      if (problems.length) {
        ctx.add({
          id: `${AREA}/robots-syntax`, area: AREA, priority: 'nice-to-have', label: 'measured',
          title: `robots.txt has ${problems.length} line(s) Google ignores`,
          observed: `${problems.length} line(s) are not user-agent, allow, disallow or sitemap.`,
          why: 'Google supports only user-agent, allow, disallow and sitemap; other lines do nothing for Google (some other crawlers read crawl-delay).',
          fix: 'Remove or fix these lines so the file says only what crawlers act on.',
          source: SOURCES.googleRobots,
          details: capList(problems),
        });
      }
      if (!outside.length && !problems.length && robots.bytes <= ROBOTS_LIMIT) ctx.pass(`${AREA}/robots`, AREA, 'robots.txt parses cleanly');
    }
  }

  // Sitemaps: declared ones, else /sitemap.xml.
  const declared = robots.parsed?.sitemaps ?? [];
  const queue: { url: string; declared: boolean }[] = declared.length
    ? declared.map((url) => ({ url, declared: true }))
    : [{ url: `${origin}/sitemap.xml`, declared: false }];
  const pageUrls: SitemapEntry[] = [];
  let complete = true;
  let filesRead = 0;
  const unreachable: string[] = [];
  const invalid: string[] = [];
  const tooLarge: string[] = [];
  let sawAnySitemap = false;

  while (queue.length) {
    const item = queue.shift() as { url: string; declared: boolean };
    if (filesRead >= MAX_SITEMAP_FILES) {
      complete = false;
      ctx.note(AREA, `Read the first ${MAX_SITEMAP_FILES} sitemap files only; ${queue.length + 1} more were not read.`);
      break;
    }
    let url: string;
    try {
      url = new URL(item.url, origin).href;
    } catch {
      invalid.push(`${item.url} (not a URL)`);
      continue;
    }
    if (!item.declared && !(await ctx.mayFetch(url))) {
      ctx.note(AREA, `Did not fetch ${url}: robots.txt disallows this tool.`);
      continue;
    }
    filesRead++;
    ctx.progress(`Reading sitemap ${url}`);
    let res;
    try {
      res = await safeFetch(ctx.net, url, { accept: 'application/xml,text/xml,*/*', maxBytes: SITEMAP_MAX_BYTES + 1 });
    } catch (error) {
      if (item.declared) unreachable.push(`${url}: ${(error as Error).message}`);
      summary.sitemaps.push({ url, status: null, kind: 'unreachable', urls: 0 });
      continue;
    }
    if (res.status < 200 || res.status >= 300) {
      if (item.declared) unreachable.push(`${url}: ${res.status}`);
      summary.sitemaps.push({ url, status: res.status, kind: 'unreachable', urls: 0 });
      continue;
    }
    sawAnySitemap = true;
    let bytes = res.body;
    let truncated = res.truncated;
    if (isGzip(bytes)) {
      const out = await gunzip(bytes, SITEMAP_MAX_BYTES + 1);
      bytes = out.bytes;
      truncated = out.truncated;
    }
    if (truncated || bytes.byteLength > SITEMAP_MAX_BYTES) tooLarge.push(`${url}: over 50 MB uncompressed`);
    const parsed = parseSitemap(decodeText(bytes, res.contentType));
    summary.sitemaps.push({ url, status: res.status, kind: parsed.kind, urls: parsed.entries.length });
    if (parsed.kind === 'invalid') {
      invalid.push(`${url}: no <urlset> or <sitemapindex> element`);
      continue;
    }
    if (parsed.entries.length > SITEMAP_MAX_URLS) tooLarge.push(`${url}: ${parsed.entries.length} entries (limit 50,000)`);
    if (parsed.kind === 'index') {
      queue.push(...parsed.entries.map((e) => ({ url: e.loc, declared: true })));
    } else {
      pageUrls.push(...parsed.entries);
    }
  }
  summary.totalUrls = pageUrls.length;

  if (unreachable.length) {
    ctx.add({
      id: `${AREA}/sitemap-unreachable`, area: AREA, priority: 'should-fix', label: 'measured',
      title: 'A declared sitemap does not load',
      observed: `${unreachable.length} sitemap URL(s) failed.`,
      why: 'Search engines cannot use a sitemap they cannot fetch; robots.txt or a sitemap index is pointing at a dead URL.',
      fix: 'Fix the URL in robots.txt (or the sitemap index), or publish the sitemap there.',
      source: SOURCES.googleSitemaps,
      details: capList(unreachable),
    });
  }
  if (invalid.length) {
    ctx.add({
      id: `${AREA}/sitemap-invalid`, area: AREA, priority: 'should-fix', label: 'measured',
      title: 'A sitemap is not a valid sitemap file',
      observed: `${invalid.length} file(s) could not be read as a sitemap.`,
      why: 'Search engines expect a <urlset> (or <sitemapindex>) XML document.',
      fix: 'Serve the sitemap as XML in the sitemaps.org format.',
      source: sitemapsOrg,
      details: capList(invalid),
    });
  }
  if (tooLarge.length) {
    ctx.add({
      id: `${AREA}/sitemap-too-large`, area: AREA, priority: 'should-fix', label: 'measured',
      title: 'A sitemap is over the size limit',
      observed: tooLarge.join('; '),
      why: 'Google limits a single sitemap to 50,000 URLs or 50 MB uncompressed.',
      fix: 'Split it into several sitemaps and list them in a sitemap index.',
      source: SOURCES.googleSitemaps,
    });
  }

  if (!sawAnySitemap && !unreachable.length) {
    ctx.add({
      id: `${AREA}/sitemap-missing`, area: AREA, priority: 'nice-to-have', label: 'measured',
      title: 'No sitemap found',
      observed: declared.length ? 'robots.txt declares sitemaps, but none could be read.' : 'robots.txt declares no sitemap, and /sitemap.xml does not exist.',
      why: 'A sitemap helps search engines find every page you want indexed, especially new or deeply linked ones.',
      fix: 'Publish /sitemap.xml with your page URLs and add "Sitemap: https://…/sitemap.xml" to robots.txt.',
      source: SOURCES.googleSitemaps,
    });
    return;
  }
  if (!pageUrls.length) return;

  const relative = pageUrls.filter((e) => !/^https?:\/\//i.test(e.loc));
  if (relative.length) {
    ctx.add({
      id: `${AREA}/sitemap-relative`, area: AREA, priority: 'should-fix', label: 'measured',
      title: `${relative.length} sitemap URL(s) are not absolute`,
      observed: `e.g. ${relative[0]?.loc}`,
      why: 'Google crawls sitemap URLs exactly as listed and asks for fully-qualified, absolute URLs.',
      fix: 'Write each <loc> as a full URL starting with https://.',
      source: SOURCES.googleSitemaps,
      details: capList(relative.map((e) => e.loc)),
    });
  }

  const withLastmod = pageUrls.filter((e) => e.lastmod);
  const badDates = withLastmod.filter((e) => !isW3cDate(e.lastmod as string));
  const tomorrow = Date.now() + 24 * 3600 * 1000;
  const future = withLastmod.filter((e) => isW3cDate(e.lastmod as string) && Date.parse(e.lastmod as string) > tomorrow);
  const distinctDates = new Set(withLastmod.map((e) => e.lastmod));
  const lastmodProblems: string[] = [];
  if (badDates.length) lastmodProblems.push(`${badDates.length} lastmod value(s) are not W3C Datetime, e.g. "${badDates[0]?.lastmod}"`);
  if (future.length) lastmodProblems.push(`${future.length} lastmod value(s) are in the future, e.g. ${future[0]?.lastmod}`);
  if (withLastmod.length >= 10 && distinctDates.size === 1) lastmodProblems.push(`all ${withLastmod.length} URLs share one lastmod (${[...distinctDates][0]}), which usually means the build time, not when each page changed`);
  if (lastmodProblems.length) {
    ctx.add({
      id: `${AREA}/sitemap-lastmod`, area: AREA, priority: 'nice-to-have', label: 'measured',
      title: 'Sitemap lastmod dates look unreliable',
      observed: lastmodProblems.join('; ') + '.',
      why: 'Google uses lastmod only when it is consistently accurate: it should be the last significant change to the page.',
      fix: 'Emit each page\'s real last-modified date in YYYY-MM-DD (or full W3C Datetime) form, or leave lastmod out.',
      source: SOURCES.googleSitemaps,
    });
  }

  if (complete) {
    const listed = pageUrls.some((e) => {
      try {
        const a = new URL(e.loc, origin);
        a.hash = '';
        const b = new URL(ctx.page.url);
        b.hash = '';
        return a.href === b.href;
      } catch {
        return false;
      }
    });
    if (!listed) {
      ctx.add({
        id: `${AREA}/sitemap-missing-page`, area: AREA, priority: 'nice-to-have', label: 'measured',
        title: 'This page is not in the sitemap',
        observed: `${ctx.page.url} is not among the ${pageUrls.length} sitemap URLs read.`,
        why: 'If the page should be indexed, listing it in the sitemap helps search engines find it.',
        fix: 'Add the exact URL (same protocol, host and trailing slash) to the sitemap, or ignore this if the page should not be indexed.',
        source: SOURCES.googleSitemaps,
      });
    } else {
      ctx.pass(`${AREA}/sitemap-lists-page`, AREA, 'This page is listed in the sitemap');
    }
  }
  if (!relative.length && !lastmodProblems.length && !tooLarge.length && !invalid.length) {
    ctx.pass(`${AREA}/sitemap`, AREA, `Sitemap readable (${pageUrls.length} URLs)`);
  }
}
