import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { audit } from '../src/audit.js';
import { parseCsp } from '../src/checks/security.js';
import { detectTags } from '../src/checks/tags.js';
import { BOTS } from '../src/facts/bots.js';
import { RICH_RESULT_TYPES, RETIRED_TYPES } from '../src/facts/rich-results.js';
import { SOURCES } from '../src/facts/sources.js';
import { TAG_SIGNATURES } from '../src/facts/tags.js';
import { parsePage } from '../src/html.js';
import { imageSize } from '../src/image.js';
import { fakeResolver, png, siteFetch, startServer, type Reply, type TestServer } from './helpers.js';

let server: TestServer;
beforeAll(async () => {
  server = await startServer();
});
afterAll(() => server.close());

/** Audits one HTML page served at https://site.test/ with the given headers. */
async function page(body: string, headers: Record<string, string | string[]> = {}, only: Parameters<typeof audit>[1] = {}) {
  server.routes.set('/', { headers: { 'content-type': 'text/html', ...headers }, body } satisfies Reply);
  return audit('https://site.test/', { fetch: siteFetch(server), resolveHost: fakeResolver(), psi: false, probeCrawlers: false, ...only });
}

describe('structured data details', () => {
  it('follows @id references and full schema.org type URLs', async () => {
    const ld = JSON.stringify([
      { '@context': 'https://schema.org', '@type': 'http://schema.org/Event', name: 'E', startDate: '2026-11-01', location: { '@id': '#venue' } },
      { '@id': '#venue', '@type': 'Place', address: { '@type': 'PostalAddress', streetAddress: '1 Main St' } },
    ]);
    const r = await page(`<title>t</title><script type="application/ld+json">${ld}</script>`, {}, { only: ['structured-data'] });
    expect(r.findings).toEqual([]);
    expect(r.data.structuredData?.types).toEqual(expect.arrayContaining(['Event', 'Place', 'PostalAddress']));
  });

  it('checks breadcrumbs, offers and nested ratings', async () => {
    const ld = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1 }] },
        { '@type': 'Product', name: 'P', offers: [{ '@type': 'Offer' }, { '@type': 'AggregateOffer', lowPrice: 1 }], aggregateRating: { ratingValue: 4 } },
      ],
    });
    const r = await page(`<script type="application/ld+json">${ld}</script>`, {}, { only: ['structured-data'] });
    const details = r.findings.flatMap((f) => f.details ?? []);
    expect(details).toEqual(expect.arrayContaining([
      'a BreadcrumbList needs at least two ListItems',
      'ListItem 1: name is required',
      'offers[0]: price (or priceSpecification.price) is required',
      'offers[1] (AggregateOffer): priceCurrency is required',
      'aggregateRating: ratingCount or reviewCount is required',
    ]));
  });

  it('suggests structured data only gently when there is none', async () => {
    const r = await page('<title>t</title>', {}, { only: ['structured-data'] });
    expect(r.findings).toEqual([expect.objectContaining({ id: 'structured-data/none', priority: 'nice-to-have', label: 'google-documented' })]);
  });
});

describe('security details', () => {
  it('accepts a strong header set over HTTPS', async () => {
    const r = await page('<title>t</title><img src="https://cdn.test/a.png">', {
      'strict-transport-security': 'max-age=63072000; includeSubDomains',
      'content-security-policy': "default-src 'self'; script-src 'self' 'nonce-abc'; frame-ancestors 'none'",
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'permissions-policy': 'camera=()',
      'set-cookie': '__Host-sid=1; Path=/; Secure; HttpOnly; SameSite=Lax',
    }, { only: ['security'] });
    expect(r.findings).toEqual([]);
    expect(r.passed.map((p) => p.id)).toEqual(expect.arrayContaining(['security/hsts', 'security/csp', 'security/clickjacking', 'security/cookies', 'security/mixed-content']));
  });

  it('flags weak CSP, short HSTS, unsafe referrer and mixed content', async () => {
    const r = await page('<script src="http://cdn.test/a.js"></script><img src="http://cdn.test/a.png">', {
      'strict-transport-security': 'max-age=300',
      'content-security-policy': "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      'referrer-policy': 'unsafe-url',
      'x-xss-protection': '1; mode=block',
      'set-cookie': '__Host-x=1; Domain=site.test; Path=/; Secure',
    }, { only: ['security'] });
    const ids = r.findings.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(['security/hsts-short', 'security/csp-weak', 'security/referrer-policy', 'security/x-xss-protection', 'security/mixed-content', 'security/mixed-content-upgradable', 'security/cookies']));
    expect(r.findings.find((f) => f.id === 'security/mixed-content')?.priority).toBe('fix-now');
  });

  it('parses CSP directives, first one wins', () => {
    expect(parseCsp("default-src 'self'; script-src a; script-src b").get('script-src')).toEqual(['a']);
  });
});

describe('meta details', () => {
  it('flags a relative or broken share image', async () => {
    server.routes.set('/share.png', { status: 404 });
    const r = await page('<title>t</title><meta property="og:image" content="/share.png"><meta property="og:title" content="x">', {}, { only: ['meta'] });
    expect(r.findings.map((f) => f.id)).toEqual(expect.arrayContaining(['meta/og-image-relative', 'meta/og-image-broken', 'meta/og-image-alt', 'meta/og-missing']));
  });

  it('flags a noindex header', async () => {
    const r = await page('<title>t</title>', { 'x-robots-tag': 'googlebot: noindex' }, { only: ['indexability'] });
    expect(r.findings.find((f) => f.id === 'indexability/noindex')?.observed).toMatch(/X-Robots-Tag/);
    const other = await page('<title>t</title>', { 'x-robots-tag': 'otherbot: noindex' }, { only: ['indexability'] });
    expect(other.findings.find((f) => f.id === 'indexability/noindex')).toBeUndefined();
  });
});

describe('facts', () => {
  it('every bot, rich-result rule and source cites an https URL', () => {
    for (const b of BOTS) expect(b.source.url, b.token).toMatch(/^https:\/\//);
    for (const r of RICH_RESULT_TYPES) expect(r.source.url).toMatch(/^https:\/\/developers\.google\.com\/search\/docs\/appearance\/structured-data\//);
    for (const r of RETIRED_TYPES) expect(r.source.url).toMatch(/^https:\/\//);
    for (const s of Object.values(SOURCES)) expect(s.url).toMatch(/^https:\/\//);
  });

  it('has unique bot tokens and about 50+ tag signatures with unique ids', () => {
    expect(new Set(BOTS.map((b) => b.token.toLowerCase())).size).toBe(BOTS.length);
    expect(TAG_SIGNATURES.length).toBeGreaterThanOrEqual(50);
    expect(new Set(TAG_SIGNATURES.map((t) => t.id)).size).toBe(TAG_SIGNATURES.length);
  });

  it('detects tags from script URLs and inline snippets, not from page text', () => {
    const doc = parsePage(`<p>We stopped using static.hotjar.com</p>
      <script>(function(w,d,s,l,i){j.src='https://www.googletagmanager.com/gtm.js?id='+i;})(window,document,'script','dataLayer','GTM-AB12CD');</script>
      <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-AB12CD"></iframe></noscript>
      <script src="https://snap.licdn.com/li.lms-analytics/insight.min.js"></script>`);
    const tags = detectTags(doc);
    expect(tags.map((t) => t.id)).toEqual(['google-tag-manager', 'linkedin-insight']);
    expect(tags[0]?.ids).toEqual(['GTM-AB12CD']);
  });

  it('reads image sizes', () => {
    expect(imageSize(png(1200, 630))).toEqual({ width: 1200, height: 630, format: 'png' });
    expect(imageSize(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x10, 0x00, 0x20, 0x00]))).toEqual({ width: 16, height: 32, format: 'gif' });
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(imageSize(jpeg)).toEqual({ width: 800, height: 600, format: 'jpeg' });
    expect(imageSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
