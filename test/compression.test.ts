import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { audit } from '../src/audit.js';
import { isCompressed } from '../src/checks/compression.js';
import { fakeResolver, siteFetch, startServer, type Reply, type TestServer } from './helpers.js';

const filler = (kb: number) => '<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.</p>\n'.repeat(Math.ceil((kb * 1024) / 85));
const page = (body: string, head = '', headers: Record<string, string> = {}): Reply => ({
  headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
  body: `<!doctype html><html lang="en"><head><title>T</title>${head}</head><body>${body}</body></html>`,
});
const gzipped = (reply: Reply): Reply => ({
  ...reply,
  headers: { ...reply.headers, 'content-encoding': 'gzip' },
  body: gzipSync(Buffer.from(String(reply.body))),
});

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const run = async (routes: Record<string, Reply>) => {
  server = await startServer(routes);
  return audit('https://site.test/', { fetch: siteFetch(server), resolveHost: fakeResolver(), psi: false, probeCrawlers: false, only: ['speed'] });
};
const byId = (r: Awaited<ReturnType<typeof audit>>) => Object.fromEntries(r.findings.map((f) => [f.id, f]));

describe('text compression', () => {
  it('flags a large page sent uncompressed, and names no-transform when that is the cause', async () => {
    const r = await run({ '/': page(filler(60), '', { 'cache-control': 'public, max-age=0, no-transform' }) });
    const f = byId(r)['speed/uncompressed-document'];
    expect(f).toMatchObject({ priority: 'should-fix', label: 'measured', source: { url: expect.stringContaining('cloudflare.com') } });
    expect(f?.observed).toMatch(/no Content-Encoding.*With gzip it would be about [\d.]+ (B|KB).*no-transform/);
    expect(f?.fix).toMatch(/Remove no-transform/);
  });

  it('passes a gzip-encoded page and lists same-origin files that are not compressed', async () => {
    const css = { headers: { 'content-type': 'text/css' }, body: '.a{color:red;margin:0 auto;padding:1rem}\n'.repeat(500) };
    const js = gzipped({ headers: { 'content-type': 'text/javascript' }, body: 'console.log("hello world");\n'.repeat(500) });
    const r = await run({
      '/': gzipped(page(filler(20), '<link rel="stylesheet" href="/app.css"><script src="/app.js"></script><link rel="stylesheet" href="https://cdn.other.test/x.css">')),
      '/app.css': css,
      '/app.js': js,
    });
    const ids = byId(r);
    expect(ids['speed/uncompressed-document']).toBeUndefined();
    expect(r.passed.map((p) => p.id)).toContain('speed/compressed-document');
    const res = ids['speed/uncompressed-resources'];
    expect(res).toMatchObject({ priority: 'nice-to-have' });
    expect(res?.details).toHaveLength(1);
    expect(res?.details?.[0]).toMatch(/^https:\/\/site\.test\/app\.css — 20 KB, about [\d.]+ (B|KB) gzipped$/);
  });

  it('ignores small responses, as Lighthouse does', async () => {
    const r = await run({ '/': page('<h1>Hi</h1>') });
    expect(r.findings.filter((f) => f.id.startsWith('speed/uncompressed'))).toEqual([]);
  });

  it('treats a local dev server gently: a reminder, not a fix', async () => {
    server = await startServer({ '/': page(filler(80)) });
    const r = await audit(`${server.origin}/`, { allowPrivate: true, psi: false, probeCrawlers: false, only: ['speed'] });
    expect(byId(r)['speed/uncompressed-document']?.priority).toBe('nice-to-have');
    expect(r.notes.some((n) => /local server/.test(n.message))).toBe(true);
  });

  it('reads Content-Encoding the way the spec writes it', () => {
    expect(isCompressed('gzip')).toBe(true);
    expect(isCompressed('BR')).toBe(true);
    expect(isCompressed('deflate, gzip')).toBe(true);
    expect(isCompressed('zstd')).toBe(true);
    expect(isCompressed('identity')).toBe(false);
    expect(isCompressed(null)).toBe(false);
  });
});
