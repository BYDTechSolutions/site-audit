import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { audit, normalizeUrl } from '../src/audit.js';
import { SiteAuditError } from '../src/errors.js';
import type { Report } from '../src/types.js';
import { startServer, type TestServer } from './helpers.js';
import { brokenSite, goodSite } from './sites.js';

let good: TestServer;
let broken: TestServer;
let goodReport: Report;
let brokenReport: Report;

const fast = { allowPrivate: true, psi: false, probeDelayMs: 0 } as const;
const ids = (r: Report) => r.findings.map((f) => f.id);
const find = (r: Report, id: string) => r.findings.find((f) => f.id === id);

beforeAll(async () => {
  good = await startServer();
  for (const [path, reply] of Object.entries(goodSite(good.origin))) good.routes.set(path, reply);
  broken = await startServer(brokenSite());
  goodReport = await audit(`${good.origin}/`, fast);
  brokenReport = await audit(`${broken.origin}/start`, fast);
});
afterAll(async () => {
  await good.close();
  await broken.close();
});

describe('audit: a healthy page', () => {
  it('has nothing to fix now or should fix', () => {
    expect(goodReport.findings.filter((f) => f.priority !== 'nice-to-have')).toEqual([]);
  });

  it('passes the main checks', () => {
    const passed = goodReport.passed.map((p) => p.id);
    for (const id of ['indexability/status', 'indexability/noindex', 'indexability/canonical', 'indexability/hreflang', 'meta/title', 'meta/og', 'meta/og-image', 'structured-data/json-parse', 'structured-data/required-properties', 'robots-sitemaps/robots', 'robots-sitemaps/sitemap', 'robots-sitemaps/sitemap-lists-page', 'llms-txt/lint', 'ai-crawlers/access', 'links/broken']) {
      expect(passed, id).toContain(id);
    }
  });

  it('reads the share card, including the image size', () => {
    expect(goodReport.data.preview).toMatchObject({ title: 'Example Co', description: 'Widgets.', image: { width: 1200, height: 630, status: 200 } });
    expect(goodReport.data.preview?.image?.dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('detects the analytics tag with its ID', () => {
    expect(goodReport.data.tags).toEqual([expect.objectContaining({ id: 'google-analytics-4', ids: ['G-ABC1234567'] })]);
  });

  it('checks links once each, ignoring fragments, mailto and the page itself', () => {
    expect(goodReport.data.links).toMatchObject({ found: 2, checked: 2, ok: 2, broken: 0 });
  });

  it('probes AI crawlers with their own user agents, one request each', () => {
    const probes = good.requests.filter((r) => r.path === '/' && /GPTBot|OAI-SearchBot|ClaudeBot|PerplexityBot|meta-externalagent|CCBot/.test(String(r.headers['user-agent'])));
    expect(probes).toHaveLength(6);
    expect(goodReport.data.crawlers?.find((c) => c.token === 'GPTBot')).toMatchObject({ robotsAllowed: true, probe: { verdict: 'same', userAgentKind: 'documented' } });
    expect(goodReport.data.crawlers?.find((c) => c.token === 'ClaudeBot')?.probe?.userAgentKind).toBe('token-only');
    expect(goodReport.data.crawlers?.find((c) => c.token === 'Google-Extended')?.probe).toBeNull();
  });

  it('skips HTTPS checks on a local dev server and says why', () => {
    expect(ids(goodReport)).not.toContain('security/no-https');
    expect(goodReport.notes.some((n) => n.area === 'security' && /own machine/.test(n.message))).toBe(true);
  });

  it('notes that PSI was skipped', () => {
    expect(goodReport.notes.some((n) => n.area === 'speed' && /--no-psi/.test(n.message))).toBe(true);
  });

  it('has no overall score anywhere', () => {
    expect(JSON.stringify(goodReport)).not.toMatch(/"(overall)?[sS]core"\s*:\s*\d/);
  });
});

describe('audit: a broken page', () => {
  it('records the redirect chain and the temporary redirect', () => {
    expect(brokenReport.data.page.redirects.map((h) => h.status)).toEqual([302, 301]);
    expect(ids(brokenReport)).toEqual(expect.arrayContaining(['indexability/redirect-chain', 'indexability/temporary-redirect']));
  });

  it('flags noindex, missing title and conflicting canonicals', () => {
    expect(find(brokenReport, 'indexability/noindex')).toMatchObject({ priority: 'fix-now', label: 'measured' });
    expect(find(brokenReport, 'meta/title-missing')?.priority).toBe('fix-now');
    expect(find(brokenReport, 'indexability/canonical-multiple')?.details).toHaveLength(2);
    expect(find(brokenReport, 'indexability/hreflang')?.details?.join(' ')).toMatch(/english/);
  });

  it('flags bad JSON-LD, missing required properties and retired types', () => {
    expect(find(brokenReport, 'structured-data/json-parse')).toMatchObject({ priority: 'should-fix', label: 'google-documented' });
    const required = brokenReport.findings.filter((f) => f.id === 'structured-data/required-properties');
    expect(required.map((f) => f.title)).toEqual(['Product snippet "Thing": required properties missing', 'Event "Launch": required properties missing']);
    expect(required[0]?.details).toEqual(['review or aggregateRating or offers is required']);
    expect(required[1]?.details).toEqual(['location.address is required']);
    expect(find(brokenReport, 'structured-data/retired-type')?.title).toMatch(/FAQPage/);
  });

  it('flags robots.txt blocks of AI search bots, separately from training bots', () => {
    const f = find(brokenReport, 'ai-crawlers/robots-blocks-search');
    expect(f?.observed).toMatch(/ChatGPT-User, PerplexityBot/);
    expect(f?.observed).not.toMatch(/GPTBot,/);
    expect(brokenReport.data.crawlers?.find((c) => c.token === 'GPTBot')?.robotsAllowed).toBe(false);
  });

  it('detects user-agent blocks and challenges, labeled indicative', () => {
    const rows = brokenReport.data.crawlers ?? [];
    expect(rows.find((c) => c.token === 'PerplexityBot')?.probe?.verdict).toBe('blocked');
    expect(rows.find((c) => c.token === 'ClaudeBot')?.probe?.verdict).toBe('challenged');
    expect(rows.find((c) => c.token === 'OAI-SearchBot')?.probe?.verdict).toBe('different');
    const f = find(brokenReport, 'ai-crawlers/firewall-blocks');
    expect(f?.observed).toMatch(/PerplexityBot/);
    expect(f?.observed).toMatch(/Indicative only/);
  });

  it('flags robots.txt problems and an unreachable declared sitemap', () => {
    expect(ids(brokenReport)).toEqual(expect.arrayContaining(['robots-sitemaps/robots-rule-outside-group', 'robots-sitemaps/robots-syntax', 'robots-sitemaps/sitemap-unreachable']));
  });

  it('flags llms.txt served as an HTML page, labeled optional', () => {
    expect(find(brokenReport, 'llms-txt/html')).toMatchObject({ label: 'optional', priority: 'nice-to-have' });
  });

  it('reports broken and unreachable links, and does not count 403 as broken', () => {
    expect(find(brokenReport, 'links/broken')?.details).toEqual([`404 ${broken.origin}/missing`, `410 ${broken.origin}/gone`]);
    expect(find(brokenReport, 'links/unreachable')?.details).toEqual([`500 ${broken.origin}/server-error`]);
    expect(brokenReport.data.links).toMatchObject({ found: 5, ok: 1, broken: 3, unverified: 1 });
  });

  it('flags security headers and cookies', () => {
    expect(ids(brokenReport)).toEqual(expect.arrayContaining(['security/csp-missing', 'security/clickjacking', 'security/nosniff', 'security/version-headers', 'security/cookies']));
    expect(find(brokenReport, 'security/cookies')?.details?.join(' ')).toMatch(/SameSite=None without Secure/);
  });

  it('detects ad pixels, session replay and consent tags', () => {
    expect(brokenReport.data.tags?.map((t) => t.id)).toEqual(['meta-pixel', 'cookiebot', 'hotjar']);
    expect(brokenReport.data.tags?.[0]?.ids).toEqual(['123456789012345']);
  });

  it('sorts findings by priority', () => {
    const order = brokenReport.findings.map((f) => ['fix-now', 'should-fix', 'nice-to-have'].indexOf(f.priority));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('every finding carries all fields and a source URL', () => {
    for (const f of [...brokenReport.findings, ...goodReport.findings]) {
      expect(f.title && f.observed && f.why && f.fix, f.id).toBeTruthy();
      expect(f.source.url, f.id).toMatch(/^https:\/\//);
    }
  });
});

describe('audit: options and errors', () => {
  it('runs only the areas asked for', async () => {
    const r = await audit(`${good.origin}/`, { ...fast, only: ['meta'] });
    expect(r.areas).toEqual(['meta']);
    expect(new Set(r.findings.map((f) => f.area).concat(r.passed.map((p) => p.area)))).toEqual(new Set(['meta']));
    expect(good.requests.filter((q) => q.path === '/robots.txt').length).toBeGreaterThan(0);
  });

  it('throws BLOCKED for a loopback target without allowPrivate', async () => {
    await expect(audit(`${good.origin}/`, { psi: false })).rejects.toMatchObject({ code: 'BLOCKED' });
  });

  it('throws FETCH when nothing answers', async () => {
    const err = await audit('http://127.0.0.1:1/', { ...fast, timeoutMs: 2000 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SiteAuditError);
    expect((err as SiteAuditError).code).toBe('FETCH');
  });

  it('respects robots.txt for link checks', async () => {
    const site = await startServer({
      '/': { headers: { 'content-type': 'text/html' }, body: '<title>x</title><a href="/private/a">a</a><a href="/b">b</a>' },
      '/robots.txt': { headers: { 'content-type': 'text/plain' }, body: 'User-agent: site-audit\nDisallow: /private\n' },
      '/b': { body: 'b' },
    });
    const r = await audit(`${site.origin}/`, { ...fast, only: ['links'] });
    expect(r.data.links).toMatchObject({ found: 2, checked: 1, skipped: 1 });
    expect(site.requests.some((q) => q.path === '/private/a')).toBe(false);
    await site.close();
  });

  it('on a dev server, accepts a canonical and sitemap entry for the same path on the production host', async () => {
    const site = await startServer({
      '/': { headers: { 'content-type': 'text/html' }, body: '<title>x</title><link rel="canonical" href="https://prod.test/">' },
      '/robots.txt': { headers: { 'content-type': 'text/plain' }, body: 'User-agent: *\nAllow: /\n' },
      '/sitemap.xml': { headers: { 'content-type': 'application/xml' }, body: '<urlset><url><loc>https://prod.test/</loc></url></urlset>' },
    });
    const r = await audit(`${site.origin}/`, { ...fast, only: ['indexability', 'robots-sitemaps'] });
    expect(r.findings.map((f) => f.id)).toEqual([]);
    expect(r.passed.map((p) => p.title)).toEqual(expect.arrayContaining(['Canonical URL points to this path on prod.test (expected on a dev server)', 'This page is listed in the sitemap']));
    await site.close();
  });

  it('adds a scheme to bare hosts', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com');
    expect(normalizeUrl('localhost:3000/x')).toBe('http://localhost:3000/x');
    expect(normalizeUrl('127.0.0.1')).toBe('http://127.0.0.1');
    expect(normalizeUrl('[::1]:8080')).toBe('http://[::1]:8080');
    expect(normalizeUrl('https://a.test')).toBe('https://a.test');
  });
});
