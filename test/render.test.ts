import { describe, expect, it } from 'vitest';
import { formatReport } from '../src/render/index.js';
import type { Report, SpeedResult } from '../src/types.js';

const report: Report = {
  tool: { name: '@bydtech/site-audit', version: '0.1.0', url: 'https://github.com/BYDTechSolutions/site-audit' },
  url: 'https://a.test/',
  finalUrl: 'https://a.test/',
  startedAt: '2026-10-21T10:00:00.000Z',
  durationMs: 1234,
  areas: ['meta', 'ai-crawlers'],
  findings: [
    {
      id: 'meta/title-missing', area: 'meta', priority: 'fix-now', label: 'measured',
      title: 'The page has no <title><script>alert(1)</script>', observed: 'No <title>.', why: 'Because.', fix: 'Add one.',
      source: { title: 'Google', url: 'javascript:alert(1)' }, details: ['a | b'],
    },
    {
      id: 'meta/description-missing', area: 'meta', priority: 'nice-to-have', label: 'google-documented',
      title: 'No meta description', observed: 'None.', why: 'Snippets.', fix: 'Add one.', source: { title: 'Google', url: 'https://developers.google.com/' },
    },
  ],
  passed: [{ id: 'meta/og', area: 'meta', title: 'Open Graph tags present' }],
  notes: [{ area: 'general', message: 'A note.' }],
  data: {
    page: { requestedUrl: 'https://a.test/', finalUrl: 'https://a.test/', status: 200, contentType: 'text/html', bytes: 10, truncated: false, redirects: [], timeMs: 5 },
    crawlers: [
      { token: 'GPTBot', operator: 'OpenAI', purpose: 'training', role: 'r', robotsAllowed: false, robotsGroup: 'gptbot', followsRobots: 'yes', probe: { status: 200, verdict: 'same', detail: '', userAgentKind: 'documented' }, source: { title: 't', url: 'https://x.test' } },
      { token: 'ClaudeBot', operator: 'Anthropic', purpose: 'training', role: 'r', robotsAllowed: true, robotsGroup: 'none', followsRobots: 'yes', probe: { status: 403, verdict: 'challenged', detail: '', userAgentKind: 'token-only' }, source: { title: 't', url: 'https://x.test' } },
    ],
    preview: { title: 'T', description: 'D', siteName: null, url: 'https://a.test/', image: null, tags: {} },
  },
};

describe('renderers', () => {
  it('text groups by priority and colors only when asked', () => {
    const plain = formatReport(report, 'text');
    expect(plain.indexOf('FIX NOW (1)')).toBeLessThan(plain.indexOf('NICE TO HAVE (1)'));
    expect(plain).not.toMatch(/SHOULD FIX/);
    expect(plain).toMatch(/\[Measured\] Meta & link previews/);
    expect(plain).toMatch(/GPTBot\s+OpenAI\s+training\s+blocked \(own group\)\s+200 ok/);
    expect(plain).toMatch(/403 CHALLENGED\*/);
    expect(plain).not.toMatch(/\u001b\[/);
    expect(formatReport(report, 'text', { color: true })).toMatch(/\u001b\[1;31mFIX NOW/);
    expect(plain).toMatch(/No overall score/);
  });

  it('html is self-contained and escapes everything', () => {
    const page = formatReport(report, 'html');
    expect(page).toMatch(/^<!doctype html>/);
    expect(page).not.toMatch(/<script/i);
    expect(page).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(page).not.toContain('href="javascript:');
    expect(page).not.toMatch(/<link[^>]+stylesheet|src="https?:/);
    expect(page).toMatch(/prefers-color-scheme:dark/);
  });

  it('markdown has sections, labels and an escaped table', () => {
    const md = formatReport(report, 'md');
    expect(md).toMatch(/^# Site audit: https:\/\/a\.test\//);
    expect(md).toMatch(/## Fix now \(1\)/);
    expect(md).toMatch(/\*Measured · Meta & link previews\*/);
    expect(md).toMatch(/\| \[GPTBot\]\(https:\/\/x\.test\) \| OpenAI \| training \| blocked \(own group\) \| 200 ok \|/);
    expect(md).toContain('\\<title\\>');
  });

  it('json round-trips', () => {
    expect(JSON.parse(formatReport(report, 'json'))).toEqual(report);
  });

  describe('speed view', () => {
    const hostile = '<img src=x onerror=alert(1)>"\'&';
    const mobile: SpeedResult = {
      strategy: 'mobile', error: null, lighthouseVersion: '13.5.0',
      metrics: [
        { id: 'largest-contentful-paint', title: 'Largest Contentful Paint', displayValue: '5.2 s', numericValue: 5210, score: 0.21 },
        { id: 'total-blocking-time', title: 'Total Blocking Time', displayValue: '420 ms', numericValue: 420, score: 0.64 },
      ],
      field: null,
      scores: { performance: 41, accessibility: 100, bestPractices: 75, seo: 92, agenticBrowsing: { passed: 2, total: 3 } },
      scoreSource: { title: 'Google Lighthouse lab score, one simulated load', url: 'https://developer.chrome.com/docs/lighthouse/performance/performance-scoring' },
      screenshots: {
        final: { mime: 'image/jpeg', dataUri: 'data:image/jpeg;base64,RklOQUw=' },
        filmstrip: [{ timingMs: 300, img: { mime: 'image/jpeg', dataUri: 'data:image/jpeg;base64,RjE=' } }],
        fullPage: { mime: 'image/webp', dataUri: 'data:image/webp;base64,RlVMTA==', width: 412, height: 2400 },
      },
      insights: [{
        id: 'render-blocking-insight', group: 'insights', title: `Render-blocking ${hostile}`, displayValue: 'Est savings of 900 ms',
        metricSavings: { LCP: 900, FCP: 0 }, description: `Requests block ${hostile}`, source: { title: 'Guide', url: 'javascript:alert(2)' },
        table: {
          columns: [{ key: 'url', label: `URL ${hostile}`, type: 'url' }, { key: 'node', label: 'Element', type: 'node' }, { key: 'totalBytes', label: 'Transfer Size', type: 'bytes' }, { key: 'wastedMs', label: 'Duration', type: 'timespanMs' }],
          rows: [{ url: '/a.css', node: `div > p — ${hostile}`, totalBytes: 20480, wastedMs: 300 }, { url: 'x | y', node: null, totalBytes: null, wastedMs: 1500 }],
          fullUrls: [{ url: 'https://a.test/a.css?q="><script>alert(3)</script>' }, { url: 'javascript:alert(4)' }],
          moreRows: 7,
        },
      }],
    };
    const desktop: SpeedResult = { ...mobile, strategy: 'desktop', scores: { performance: 92 }, screenshots: undefined, insights: [] };
    const speedReport: Report = { ...report, areas: ['speed'], data: { ...report.data, speed: [mobile, desktop] } };

    it('html shows Google\'s scores, metrics, screenshots and insight tables, script-free and escaped', () => {
      const page = formatReport(speedReport, 'html');
      expect(page).not.toMatch(/<script/i);
      expect(page).not.toMatch(/<img[^>]*onerror/);
      expect(page).not.toContain('href="javascript:');
      expect(page).toContain('&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;');
      expect(page).toContain('href="https://a.test/a.css?q=&quot;&gt;&lt;script&gt;alert(3)&lt;/script&gt;"');
      // CSS-only tabs for two strategies.
      expect(page).toMatch(/<input type="radio" class="tab-input" name="speed-tab" id="speed-tab-mobile" checked>/);
      expect(page).toContain('<label for="speed-tab-desktop">Desktop</label>');
      expect(page).toMatch(/Google Lighthouse lab score/);
      expect(page).toContain('aria-label="Performance: 41 out of 100 (Poor)"');
      expect(page).toContain('aria-label="Performance: 92 out of 100 (Good)"');
      expect(page).toContain('aria-label="Agentic browsing: 2 of 3 audits passed (Needs improvement)"><span>2/3</span>');
      expect(page).toContain('aria-label="Best practices: 75 out of 100 (Needs improvement)"');
      // Google's scores come first: a compact row under the summary, before the fix list.
      const strip = page.indexOf('class="strips"');
      expect(strip).toBeGreaterThan(page.indexOf('class="chips"'));
      expect(strip).toBeLessThan(page.indexOf('<h2>Fix now'));
      expect(page.slice(strip, page.indexOf('</div><p', strip))).toMatch(/Mobile.*Performance.*Desktop.*Performance/s);
      expect(page).toContain("Scores are Google&#39;s Lighthouse lab scores for one simulated load; the fix list below is what to do about them.");
      expect(page).toContain('the fix list is what to do about them. We add no overall score of our own.</p>');
      expect(page).not.toContain('on purpose');
      // In the speed section, the score rings lead the panel.
      const panel = page.indexOf('class="tab-panel panel-mobile"');
      expect(page.indexOf('class="scores"', panel)).toBeLessThan(page.indexOf('class="metrics"', panel));
      // Metric colors: LCP by the Core Web Vitals threshold, TBT by Lighthouse's metric score.
      expect(page).toMatch(/class="metric r-poor"[^]*Poor \(Core Web Vitals threshold\)/);
      expect(page).toContain('Needs improvement (Lighthouse metric score)');
      // Screenshots, lazy and with alt text so the page reads without images.
      expect(page).toContain('src="data:image/jpeg;base64,RjE=" alt="Frame at 300 ms" loading="lazy"');
      expect(page).toMatch(/<div class="fullpage"><img src="data:image\/webp;base64,RlVMTA==" width="412" height="2400" alt="Full-page screenshot \(mobile\)" loading="lazy">/);
      expect(page).toContain('Screenshots were not included in this report.');
      // Table cells formatted, 7 more rows pointed at the full trace.
      expect(page).toContain('<td class="num">20.0 KiB</td><td class="num">300 ms</td>');
      expect(page).toContain('<td class="num">1.5 s</td>');
      expect(page).toMatch(/7 more row\(s\) in the <a href="https:\/\/pagespeed\.web\.dev\/analysis\?/);
    });

    it('text prints Google\'s scores and never base64', () => {
      const out = formatReport(speedReport, 'text');
      expect(out.replace(/\s+/g, ' ')).toContain('Lighthouse performance (Google lab score): 41 / 100 · accessibility: 100 / 100 · best practices: 75 / 100 · SEO: 92 / 100 · agentic browsing: 2/3 audits passed');
      expect(out).toContain('Lighthouse performance (Google lab score): 92 / 100');
      expect(out.replace(/\s+/g, ' ').match(/the fix list above is what to do about them/g)).toHaveLength(1);
      // The score row is the first line under each SPEED heading.
      expect(out).toMatch(/SPEED \(PageSpeed Insights, mobile, Lighthouse 13\.5\.0\)\n  Lighthouse performance/);
      expect(out.replace(/\s+/g, ' ')).toContain('We add no overall score of our own.');
      expect(out).not.toMatch(/base64|data:image/);
    });

    it('markdown carries scores and escaped insight tables', () => {
      const md = formatReport(speedReport, 'md');
      expect(md).toContain('**Lighthouse performance (Google lab score): 41 / 100 · accessibility: 100 / 100 · best practices: 75 / 100 · SEO: 92 / 100 · agentic browsing: 2/3 audits passed**');
      expect(md).toContain('<summary>Render-blocking &lt;img src=x onerror=alert(1)&gt;"\'&amp; — Est savings of 900 ms</summary>');
      expect(md).toContain('| URL \\<img src=x onerror=alert(1)\\>"\'& | Element | Transfer Size | Duration |');
      expect(md).toContain('|---|---|---:|---:|');
      expect(md).toContain('[/a.css](https://a.test/a.css?q="%3E%3Cscript%3Ealert%283%29%3C/script%3E)');
      expect(md).toContain('| x \\| y |');
      expect(md).not.toMatch(/javascript:alert\([24]\)/);
      expect(md).not.toMatch(/base64/);
      expect(md).toContain('7 more row(s)');
    });

    it('json keeps screenshots only when the report has them', () => {
      const parsed = JSON.parse(formatReport(speedReport, 'json'));
      expect(parsed.data.speed[0].screenshots.final.mime).toBe('image/jpeg');
      expect(parsed.data.speed[1].screenshots).toBeUndefined();
      expect(parsed.data.speed[0].insights[0].table.moreRows).toBe(7);
    });
  });
});
