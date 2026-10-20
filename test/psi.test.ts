import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { audit } from '../src/audit.js';
import { fieldMetricName, plain, psiReportUrl, psiRequestUrl } from '../src/checks/psi.js';
import { fakeResolver, fixture, json, siteFetch, startServer, type TestServer } from './helpers.js';
import { goodSite } from './sites.js';

let server: TestServer;
const calls: URL[] = [];

beforeAll(async () => {
  server = await startServer(goodSite('https://site.test'));
});
afterAll(() => server.close());

const run = (psi: (url: URL) => Response, extra: Parameters<typeof audit>[1] = {}) =>
  audit('https://site.test/', {
    fetch: siteFetch(server, (url) => {
      calls.push(url);
      return psi(url);
    }),
    resolveHost: fakeResolver(),
    probeCrawlers: false,
    only: ['speed', 'accessibility'],
    ...extra,
  });

describe('PageSpeed Insights', () => {
  it('builds the v5 request', () => {
    const url = new URL(psiRequestUrl('https://a.test/', 'mobile', ['PERFORMANCE', 'ACCESSIBILITY'], 'k'));
    expect(url.origin + url.pathname).toBe('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
    expect(url.searchParams.get('strategy')).toBe('MOBILE');
    expect(url.searchParams.getAll('category')).toEqual(['PERFORMANCE', 'ACCESSIBILITY']);
    expect(url.searchParams.get('key')).toBe('k');
  });

  it('maps lab metrics, failing insights, field data and accessibility failures', async () => {
    calls.length = 0;
    const r = await run(() => json(fixture('psi-mobile.json')), { psiKey: 'test-key' });
    expect(calls[0]?.searchParams.get('key')).toBe('test-key');
    const speed = r.data.speed?.[0];
    expect(speed).toMatchObject({ strategy: 'mobile', error: null, lighthouseVersion: '13.5.0' });
    expect(speed?.metrics.map((m) => m.id)).toEqual(['first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift', 'speed-index']);
    expect(speed?.field).toMatchObject({ scope: 'page', overallCategory: 'SLOW' });

    const byId = Object.fromEntries(r.findings.map((f) => [f.id, f]));
    expect(byId['speed/metric-largest-contentful-paint']).toMatchObject({ priority: 'should-fix', label: 'measured' });
    expect(byId['speed/metric-total-blocking-time']?.priority).toBe('nice-to-have');
    expect(byId['speed/metric-first-contentful-paint']).toBeUndefined();
    expect(byId['speed/render-blocking-insight']).toMatchObject({ priority: 'should-fix', source: { url: 'https://developer.chrome.com/docs/performance/insights/render-blocking' } });
    expect(byId['speed/unused-javascript']?.priority).toBe('nice-to-have');
    expect(byId['speed/image-delivery-insight']).toBeUndefined();
    expect(byId['speed/field-largest_contentful_paint_ms']).toMatchObject({ priority: 'should-fix', label: 'google-documented' });
    expect(byId['speed/field-interaction_to_next_paint']?.priority).toBe('nice-to-have');
    expect(byId['speed/field-first_contentful_paint_ms']).toBeUndefined();
    expect(byId['accessibility/image-alt']).toMatchObject({ priority: 'should-fix', details: ['main > img — <img src="hero.jpg">'] });
    expect(byId['accessibility/color-contrast']?.details).toHaveLength(2);
    expect(byId['accessibility/html-has-lang']).toBeUndefined();
    expect(r.notes.some((n) => /only part of accessibility/.test(n.message))).toBe(true);
  });

  it('keeps going when the quota is exhausted, and says so', async () => {
    const r = await run(() => json(fixture('psi-quota-429.json'), 429));
    expect(r.data.speed?.[0]?.error).toMatch(/Quota exceeded/);
    expect(r.notes.find((n) => n.area === 'speed')?.message).toMatch(/quota exceeded.*--psi-key or set PSI_API_KEY/i);
    expect(r.findings.filter((f) => f.area === 'speed')).toEqual([]);
  });

  it('never prints the API key in errors', async () => {
    const r = await run(() => json({ error: { code: 400, message: 'API key not valid: secret-key-123' } }, 400), { psiKey: 'secret-key-123' });
    expect(JSON.stringify(r)).not.toContain('secret-key-123');
  });

  it('says plainly when there is no field data', async () => {
    const data = JSON.parse(fixture('psi-mobile.json'));
    data.loadingExperience = { id: 'https://site.test/', metrics: {} };
    const r = await run(() => json(data), { only: ['speed'] });
    expect(r.data.speed?.[0]?.field).toBeNull();
    expect(r.notes.some((n) => /not enough real-user traffic for field data/.test(n.message))).toBe(true);
    expect(calls.at(-1)?.searchParams.getAll('category')).toEqual(['PERFORMANCE']);
  });

  it('runs desktop too when asked', async () => {
    calls.length = 0;
    const r = await run(() => json(fixture('psi-mobile.json')), { strategies: ['mobile', 'desktop'], only: ['speed'] });
    expect(calls.map((c) => c.searchParams.get('strategy'))).toEqual(['MOBILE', 'DESKTOP']);
    expect(r.data.speed?.map((s) => s.strategy)).toEqual(['mobile', 'desktop']);
  });

  it('does not call PSI for a local target', async () => {
    calls.length = 0;
    const r = await audit(`${server.origin}/`, { allowPrivate: true, only: ['speed'], fetch: siteFetch(server, () => { throw new Error('no'); }) });
    expect(calls).toEqual([]);
    expect(r.notes[0]?.message).toMatch(/cannot reach/);
  });

  it('drops the "Learn more" sentences Lighthouse appends, keeping links that are part of a sentence', () => {
    expect(plain('First Contentful Paint marks when the first text is painted. [Learn more about the First Contentful Paint metric](https://x.test/fcp).'))
      .toBe('First Contentful Paint marks when the first text is painted.');
    expect(plain('Polyfills are often unneeded. Learn why most sites can deploy ES6+ code without transpiling'))
      .toBe('Polyfills are often unneeded.');
    expect(plain('Low contrast is hard to read. [Learn how to provide sufficient color contrast](https://x.test/c).'))
      .toBe('Low contrast is hard to read.');
    expect(plain('Requests block the first render. [Deferring or inlining](https://x.test/r) moves them off the critical path.'))
      .toBe('Requests block the first render. Deferring or inlining moves them off the critical path.');
  });

  it('says which insights hold a metric back, and lists the resources an insight names', async () => {
    const r = await run(() => json(fixture('psi-mobile.json')), { only: ['speed'] });
    const byId = Object.fromEntries(r.findings.map((f) => [f.id, f]));
    const lcp = byId['speed/metric-largest-contentful-paint'];
    expect(lcp?.why).not.toMatch(/learn more/i);
    // Largest saving first; an insight with no LCP saving is not blamed.
    expect(lcp?.fix).toMatch(/Render-blocking requests \(about 900 ms\); Reduce unused JavaScript \(about 100 ms\)/);
    expect(lcp?.fix).toContain(psiReportUrl('https://site.test/', 'mobile'));
    const tbt = byId['speed/metric-total-blocking-time'];
    expect(tbt?.fix).toMatch(/names no single insight/);
    const blocking = byId['speed/render-blocking-insight'];
    expect(blocking?.details).toEqual(['https://site.test/fonts.css', 'https://site.test/app.css']);
    expect(blocking?.fix).toMatch(/resources listed below/);
    expect(byId['speed/unused-javascript']?.fix).toContain('pagespeed.web.dev/analysis?');
  });

  it('names field metrics from their keys', () => {
    expect(fieldMetricName('LARGEST_CONTENTFUL_PAINT_MS')).toBe('Largest contentful paint');
    expect(fieldMetricName('EXPERIMENTAL_TIME_TO_FIRST_BYTE')).toBe('Time to first byte (experimental)');
  });
});
