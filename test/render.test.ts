import { describe, expect, it } from 'vitest';
import { formatReport } from '../src/render/index.js';
import type { Report } from '../src/types.js';

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
});
