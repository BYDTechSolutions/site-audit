import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { main, type CliIo } from '../src/cli-main.js';
import { fakeResolver, fixture, json, siteFetch, startServer, type TestServer } from './helpers.js';
import { brokenSite, goodSite } from './sites.js';

let good: TestServer;
let broken: TestServer;
let psiSite: TestServer;

beforeAll(async () => {
  good = await startServer();
  for (const [path, reply] of Object.entries(goodSite(good.origin))) good.routes.set(path, reply);
  broken = await startServer(brokenSite());
  psiSite = await startServer(goodSite('https://site.test'));
});
afterAll(async () => {
  await good.close();
  await broken.close();
  await psiSite.close();
});

function io(env: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const files = new Map<string, string>();
  const value: CliIo = {
    stdout: (t) => out.push(t),
    stderr: (t) => err.push(t),
    env,
    stdoutIsTTY: false,
    stderrIsTTY: false,
    writeFile: async (p, d) => {
      files.set(p, d);
    },
    auditOptions: { probeDelayMs: 0 },
  };
  return { value, out: () => out.join(''), err: () => err.join(''), files };
}

describe('cli', () => {
  it('prints help and version', async () => {
    const a = io();
    expect(await main(['--help'], a.value)).toBe(0);
    expect(a.out()).toMatch(/Usage: site-audit <url>/);
    const b = io();
    expect(await main(['-v'], b.value)).toBe(0);
    expect(b.out()).toMatch(/^\d+\.\d+\.\d+\n$/);
  });

  it.each([
    [[], /Give a URL/],
    [['a.test', 'b.test'], /exactly one URL/],
    [['a.test', '--format', 'pdf'], /--format must be/],
    [['a.test', '--only', 'seo'], /Unknown area/],
    [['a.test', '--fail-on', 'all'], /--fail-on must be/],
    [['a.test', '--max-links', '-1'], /--max-links/],
    [['a.test', '--bogus'], /Unknown option/],
  ])('exits 2 on bad usage: %j', async (args, message) => {
    const t = io();
    expect(await main(args as string[], t.value)).toBe(2);
    expect(t.err()).toMatch(message);
  });

  it('audits a local dev server without any flag for private targets, and prints a grouped report', async () => {
    const t = io();
    expect(await main([`${good.origin}/`, '--no-psi'], t.value)).toBe(0);
    expect(t.out()).toMatch(/^Site audit: http:\/\/127\.0\.0\.1/);
    expect(t.out()).toMatch(/AI CRAWLER ACCESS/);
    expect(t.out()).not.toMatch(/\u001b\[/);
  });

  it('prints JSON and fails CI with --fail-on', async () => {
    const t = io();
    expect(await main([`${broken.origin}/`, '--no-psi', '--format', 'json', '--fail-on', 'fix-now'], t.value)).toBe(1);
    const report = JSON.parse(t.out());
    expect(report.findings.some((f: { priority: string }) => f.priority === 'fix-now')).toBe(true);
    expect(t.err()).toMatch(/finding\(s\) at fix-now/);
    const ok = io();
    expect(await main([`${good.origin}/`, '--no-psi', '--format', 'json', '--fail-on', 'should-fix'], ok.value)).toBe(0);
  });

  it('writes the format named by --out', async () => {
    const t = io();
    expect(await main([`${broken.origin}/`, '--no-psi', '--out', 'report.html', '--only', 'meta,security'], t.value)).toBe(0);
    const [path, body] = [...t.files][0] as [string, string];
    expect(path).toMatch(/report\.html$/);
    expect(body).toMatch(/^<!doctype html>/);
    expect(body).not.toMatch(/<script|https?:\/\/[^"]+\.(css|js)"/);
    expect(t.out()).toMatch(/Wrote html report to .*report\.html: \d+ fix now/);
  });

  it('several --out files write several formats from one audit, and --fail-on still applies', async () => {
    const t = io();
    const args = [`${broken.origin}/`, '--no-psi', '--only', 'meta,security', '-o', 'r.txt', '-o', 'r.md', '-o', 'r.json', '-o', 'r.html', '--fail-on', 'should-fix'];
    expect(await main(args, t.value)).toBe(1);
    const byExt = (ext: string) => [...t.files.entries()].find(([p]) => p.endsWith(ext))?.[1] as string;
    expect(t.files.size).toBe(4);
    expect(byExt('r.txt')).not.toContain('\u001b[');
    expect(byExt('r.md')).toMatch(/^# /m);
    expect(JSON.parse(byExt('r.json')).findings.length).toBeGreaterThan(0);
    expect(byExt('r.html')).toMatch(/^<!doctype html>/);
    expect(t.out()).toMatch(/Wrote md report to .*r\.md/);
    const bad = io();
    expect(await main([`${broken.origin}/`, '-f', 'json', '-o', 'a.json', '-o', 'b.md'], bad.value)).toBe(2);
    expect(bad.err()).toContain('--format works with one --out');
  });

  it('exits 2 when the page cannot be fetched', async () => {
    const t = io();
    expect(await main(['http://127.0.0.1:1/', '--no-psi', '--timeout', '2000'], t.value)).toBe(2);
    expect(t.err()).toMatch(/Could not fetch/);
  });

  it('reads the PSI key from PSI_API_KEY and keeps --psi-key first', async () => {
    const keys: (string | null)[] = [];
    const run = async (args: string[], env: Record<string, string>) => {
      const t = io(env);
      t.value.auditOptions = {
        probeDelayMs: 0,
        resolveHost: fakeResolver(),
        fetch: siteFetch(psiSite, (url) => {
          keys.push(url.searchParams.get('key'));
          return json(fixture('psi-quota-429.json'), 429);
        }),
      };
      return main(['https://site.test/', '--only', 'speed', ...args], t.value);
    };
    expect(await run([], { PSI_API_KEY: 'env-key' })).toBe(0);
    expect(await run(['--psi-key', 'flag-key'], { PSI_API_KEY: 'env-key' })).toBe(0);
    expect(await run([], {})).toBe(0);
    expect(keys).toEqual(['env-key', 'flag-key', null]);
  });

  it('keeps PSI screenshots for html or --screenshots only, and never prints base64 as text', async () => {
    const run = async (args: string[]) => {
      const t = io();
      t.value.auditOptions = { probeDelayMs: 0, resolveHost: fakeResolver(), fetch: siteFetch(psiSite, () => json(fixture('psi-mobile.json'))) };
      expect(await main(['https://site.test/', '--only', 'speed', ...args], t.value)).toBe(0);
      return t.out();
    };
    const text = await run([]);
    expect(text).toContain('Lighthouse performance (Google lab score): 41 / 100');
    expect(text).not.toContain('base64');
    expect(JSON.parse(await run(['--format', 'json'])).data.speed[0].screenshots).toBeUndefined();
    expect(JSON.parse(await run(['--format', 'json', '--screenshots'])).data.speed[0].screenshots.filmstrip).toHaveLength(3);
    expect(await run(['--format', 'html'])).toContain('src="data:image/jpeg;base64,RlJBTUUtMQ=="');
  });
});
