import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { audit } from '../src/audit.js';
import { fieldMetricName, INSIGHT_ROW_CAP, SPEED_CATEGORIES, insightTable, plain, psiReportUrl, psiRequestUrl, scoresOf, shortUrl } from '../src/checks/psi.js';
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
    // Only the compression check (which needs no PSI) may report speed findings here.
    expect(r.findings.filter((f) => f.area === 'speed' && !f.id.includes('compress'))).toEqual([]);
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
    expect(calls.at(-1)?.searchParams.getAll('category')).toEqual([...SPEED_CATEGORIES]);
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

describe('PageSpeed-style speed view', () => {
  it('maps Google\'s Lighthouse category scores to 0-100 integers, as data only', async () => {
    const r = await run(() => json(fixture('psi-mobile.json')));
    const speed = r.data.speed?.[0];
    expect(speed?.scores).toEqual({ performance: 41, accessibility: 82, bestPractices: 96, seo: 92, agenticBrowsing: { passed: 2, total: 3 } });
    expect(speed?.scoreSource?.title).toMatch(/Google Lighthouse lab score, one simulated load/);
    expect(speed?.scoreSource?.url).toBe('https://developer.chrome.com/docs/lighthouse/performance/performance-scoring');
    // The report itself still has no score.
    expect(Object.keys(r)).not.toContain('score');
  });

  it('rounds scores and leaves out categories that were not run or have no score', () => {
    expect(scoresOf({ performance: { score: 0.995 }, accessibility: { score: 0.004 } })).toEqual({ performance: 100, accessibility: 0 });
    expect(scoresOf({ performance: { score: 0.784 }, accessibility: { score: null } })).toEqual({ performance: 78 });
    expect(scoresOf({ pwa: { score: 1 } })).toBeUndefined();
    expect(scoresOf(undefined)).toBeUndefined();
  });

  it('leaves out categories PSI did not return', async () => {
    const data = JSON.parse(fixture('psi-mobile.json'));
    delete data.lighthouseResult.categories.accessibility;
    delete data.lighthouseResult.categories['agentic-browsing'];
    const r = await run(() => json(data), { only: ['speed'] });
    expect(r.data.speed?.[0]?.scores).toEqual({ performance: 41, bestPractices: 96, seo: 92 });
  });

  it('requests every PSI v5 category with speed, and only accessibility without it', async () => {
    calls.length = 0;
    await run(() => json(fixture('psi-mobile.json')), { only: ['speed'] });
    expect(calls[0]?.searchParams.getAll('category')).toEqual(['PERFORMANCE', 'ACCESSIBILITY', 'BEST_PRACTICES', 'SEO', 'AGENTIC_BROWSING']);
    calls.length = 0;
    const r = await run(() => json(fixture('psi-mobile.json')), { only: ['accessibility'] });
    expect(calls[0]?.searchParams.getAll('category')).toEqual(['ACCESSIBILITY']);
    expect(r.data.speed).toBeUndefined();
  });

  it('counts agentic browsing as passed / total, the way Lighthouse shows it', () => {
    const audits = { a: { score: 1, scoreDisplayMode: 'binary' }, b: { score: 0.89, scoreDisplayMode: 'numeric' }, c: { score: null, scoreDisplayMode: 'manual' }, d: { score: 0, scoreDisplayMode: 'informative' }, e: { score: null, scoreDisplayMode: 'error' }, h: { score: 1, scoreDisplayMode: 'binary' } };
    const cat = { score: 0.5, categoryScoreDisplayMode: 'fraction', auditRefs: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, weight: 1 })).concat([{ id: 'h', weight: 0, group: 'hidden' } as never]) };
    expect(scoresOf({ 'agentic-browsing': cat }, audits)).toEqual({ agenticBrowsing: { passed: 1, total: 3 } });
    expect(scoresOf({ 'agentic-browsing': { ...cat, auditRefs: [{ id: 'c', weight: 1 }] } }, audits)).toBeUndefined();
  });

  it('runs again without agentic browsing if PSI refuses that category', async () => {
    calls.length = 0;
    const r = await run((url) => url.searchParams.getAll('category').includes('AGENTIC_BROWSING')
      ? json({ error: { code: 400, message: 'Invalid value at \'category\' (TYPE_ENUM), "AGENTIC_BROWSING"' } }, 400)
      : json(fixture('psi-mobile.json')), { only: ['speed'] });
    expect(calls.map((c) => c.searchParams.getAll('category').length)).toEqual([5, 4]);
    expect(r.data.speed?.[0]?.error).toBeNull();
    expect(r.notes.some((n) => /refused the agentic browsing category/.test(n.message))).toBe(true);
  });

  it('keeps screenshots out unless asked', async () => {
    const r = await run(() => json(fixture('psi-mobile.json')));
    expect(r.data.speed?.[0]?.screenshots).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain('base64');
  });

  it('reads the final frame, the filmstrip and the full page with screenshots: true', async () => {
    const r = await run(() => json(fixture('psi-mobile.json')), { screenshots: true });
    const shots = r.data.speed?.[0]?.screenshots;
    expect(shots?.final).toEqual({ mime: 'image/jpeg', dataUri: 'data:image/jpeg;base64,RklOQUwtU0NSRUVOU0hPVA==' });
    expect(shots?.filmstrip?.map((f) => f.timingMs)).toEqual([300, 1500, 3000]);
    expect(shots?.filmstrip?.[0]?.img.mime).toBe('image/jpeg');
    expect(shots?.fullPage).toMatchObject({ mime: 'image/webp', width: 412, height: 2400 });
  });

  it('drops a full-page screenshot over the cap, with a note', async () => {
    const r = await run(() => json(fixture('psi-mobile.json')), { screenshots: true, fullPageScreenshotMaxBytes: 20 });
    const shots = r.data.speed?.[0]?.screenshots;
    expect(shots?.fullPage).toBeUndefined();
    expect(shots?.final).toBeDefined();
    expect(r.notes.some((n) => n.area === 'speed' && /Full-page screenshot \(mobile\) left out: .* over the 1 KB cap/.test(n.message))).toBe(true);
  });

  it('ignores screenshot data that is not a data:image URI', async () => {
    const data = JSON.parse(fixture('psi-mobile.json'));
    data.lighthouseResult.audits['final-screenshot'].details.data = 'javascript:alert(1)';
    data.lighthouseResult.audits['screenshot-thumbnails'].details.items[0].data = 'data:text/html;base64,PHNjcmlwdD4=';
    data.lighthouseResult.fullPageScreenshot = null;
    const r = await run(() => json(data), { screenshots: true, only: ['speed'] });
    const shots = r.data.speed?.[0]?.screenshots;
    expect(shots?.final).toBeUndefined();
    expect(shots?.fullPage).toBeUndefined();
    expect(shots?.filmstrip?.map((f) => f.timingMs)).toEqual([1500, 3000]);
  });

  it('carries every failing insight with a normalized table', async () => {
    const r = await run(() => json(fixture('psi-mobile.json')), { only: ['speed'] });
    const insights = r.data.speed?.[0]?.insights ?? [];
    expect(insights.map((i) => i.id)).toEqual(['render-blocking-insight', 'unused-javascript', 'third-parties-insight']);
    const blocking = insights[0];
    expect(blocking).toMatchObject({
      group: 'insights', title: 'Render-blocking requests', displayValue: 'Est savings of 900 ms', metricSavings: { FCP: 900, LCP: 900 },
      description: 'Requests are blocking the first render. Deferring or inlining moves them off the critical path.',
      source: { url: 'https://developer.chrome.com/docs/performance/insights/render-blocking' },
    });
    expect(blocking?.table?.columns).toEqual([
      { key: 'url', label: 'URL', type: 'url' },
      { key: 'totalBytes', label: 'Transfer Size', type: 'bytes' },
      { key: 'wastedMs', label: 'Duration', type: 'timespanMs' },
    ]);
    expect(blocking?.table?.rows[0]).toEqual({ url: '/fonts.css', totalBytes: 4096, wastedMs: 600 });
    expect(blocking?.table?.rows[2]).toEqual({ url: '/fonts.css', totalBytes: 4096, wastedMs: null });
    expect(blocking?.table?.fullUrls[0]).toEqual({ url: 'https://site.test/fonts.css' });
    expect(blocking?.table?.moreRows).toBe(0);
    // A diagnostic with no details has no table.
    expect(insights[1]?.group).toBe('diagnostics');
    expect(insights[1]?.table).toBeUndefined();

    const third = insights[2]?.table;
    expect(third?.columns.map((c) => c.key)).toEqual(['entity', 'url', 'transferSize', 'mainThreadTime']); // thumbnail dropped
    const [vendor, fonts] = third?.rows ?? [];
    expect(String(vendor?.url)).toMatch(/^cdn\.vendor\.test\/widgets\/.*…/);
    expect(String(vendor?.url).length).toBeLessThanOrEqual(72);
    expect(third?.fullUrls[0]?.url).toBe('https://cdn.vendor.test/widgets/v3/bundle.min.js?build=2026-10-21&locale=en-US&features=chat,analytics,experiments');
    expect(fonts).toEqual({ entity: 'Fonts CDN', url: 'fonts.vendor.test/css2:1', transferSize: 2048, mainThreadTime: 0 });
    expect(third?.fullUrls[1]).toEqual({ entity: 'https://fonts.vendor.test/', url: 'https://fonts.vendor.test/css2' });
  });

  it('caps table rows and counts the rest', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ url: `https://a.test/img-${i}.png`, wastedBytes: 1000 * i, node: { type: 'node', selector: `img.n${i}`, snippet: `<img src="img-${i}.png">` } }));
    const t = insightTable({ type: 'opportunity', headings: [{ key: 'node', valueType: 'node', label: '' }, { key: 'url', valueType: 'url', label: 'URL' }, { key: 'wastedBytes', valueType: 'bytes', label: 'Est Savings' }, { key: null, valueType: 'text', label: 'x' }], items }, 'https://a.test');
    expect(INSIGHT_ROW_CAP).toBe(15);
    expect(t?.rows).toHaveLength(15);
    expect(t?.fullUrls).toHaveLength(15);
    expect(t?.moreRows).toBe(5);
    expect(t?.columns.map((c) => c.label)).toEqual(['Element', 'URL', 'Est Savings']);
    expect(t?.rows[3]).toEqual({ node: 'img.n3 — <img src="img-3.png">', url: '/img-3.png', wastedBytes: 3000 });
  });

  it('finds the table inside a list, turns a checklist into rows, and skips shapes without a table', () => {
    const list = insightTable({ type: 'list', items: [{ type: 'list-section', value: { type: 'table', headings: [{ key: 'label', valueType: 'text', label: 'Subpart' }, { key: 'duration', valueType: 'ms', label: 'Duration' }], items: [{ label: 'Time to first byte', duration: 610 }] } }, { type: 'node', selector: 'h1' }] }, 'https://a.test');
    expect(list?.rows).toEqual([{ label: 'Time to first byte', duration: 610 }]);
    const checklist = insightTable({ type: 'checklist', items: { noRedirects: { value: true, label: 'Avoids redirects' }, usesCompression: { value: false, label: 'Applies text compression' } } }, 'https://a.test');
    expect(checklist?.rows).toEqual([{ label: 'Avoids redirects', value: 'yes' }, { label: 'Applies text compression', value: 'no' }]);
    expect(insightTable({ type: 'network-tree', chains: {} }, 'https://a.test')).toBeUndefined();
    expect(insightTable({ type: 'table', headings: [{ key: 'url', valueType: 'url', label: 'URL' }], items: [] }, 'https://a.test')).toBeUndefined();
    expect(insightTable(undefined, 'https://a.test')).toBeUndefined();
  });

  it('shortens URLs for display', () => {
    expect(shortUrl('https://a.test/app.css?v=2', 'https://a.test')).toBe('/app.css?v=2');
    expect(shortUrl('https://cdn.test/', 'https://a.test')).toBe('cdn.test');
    expect(shortUrl('https://cdn.test/x.js', 'https://a.test')).toBe('cdn.test/x.js');
    expect(shortUrl(`https://cdn.test/${'a'.repeat(200)}.js`, 'https://a.test', 40)).toMatch(/^cdn\.test\/a+…a+\.js$/);
    expect(shortUrl(`https://cdn.test/${'a'.repeat(200)}.js`, 'https://a.test', 40)).toHaveLength(40);
    expect(shortUrl(`data:image/png;base64,${'A'.repeat(500)}`, 'https://a.test').length).toBeLessThanOrEqual(32);
  });

  it('leaves every finding exactly as it was, with or without screenshots', async () => {
    const without = await run(() => json(fixture('psi-mobile.json')), { strategies: ['mobile', 'desktop'] });
    const withShots = await run(() => json(fixture('psi-mobile.json')), { strategies: ['mobile', 'desktop'], screenshots: true });
    expect(withShots.findings).toEqual(without.findings);
    expect(withShots.passed).toEqual(without.passed);
  });
});
