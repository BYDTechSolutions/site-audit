import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SiteAuditError } from '../src/errors.js';
import { createContext, safeFetch } from '../src/net/fetcher.js';
import { fakeResolver, redirect, siteFetch, startServer, text, type TestServer } from './helpers.js';

let server: TestServer;

beforeAll(async () => {
  server = await startServer({
    '/a': redirect('/b', 302),
    '/b': redirect('/c', 301),
    '/c': text('final'),
    '/loop': redirect('/loop'),
    '/big': text('x'.repeat(10_000)),
    '/slow': { ...text('late'), delayMs: 1500 },
    '/to-metadata': redirect('http://169.254.169.254/latest/meta-data/', 302),
    '/to-internal': redirect('http://internal.test/admin', 302),
    '/to-file': redirect('file:///etc/passwd', 302),
    '/ua': (req) => text(String(req.headers['user-agent'])),
  });
});
afterAll(() => server.close());

const publicCtx = (extra = {}) =>
  createContext({ fetch: siteFetch(server), resolveHost: fakeResolver({ 'internal.test': ['10.0.0.8'] }), ...extra });

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'resolved';
  } catch (error) {
    return error instanceof SiteAuditError ? error.code : String(error);
  }
};

describe('safeFetch', () => {
  it('follows redirects and records each hop', async () => {
    const res = await safeFetch(createContext({ allowPrivate: true }), `${server.origin}/a`);
    expect(res.status).toBe(200);
    expect(res.url).toBe(`${server.origin}/c`);
    expect(res.redirects).toEqual([
      { url: `${server.origin}/a`, status: 302 },
      { url: `${server.origin}/b`, status: 301 },
    ]);
  });

  it('caps redirects, body size and time', async () => {
    const ctx = createContext({ allowPrivate: true, maxRedirects: 3 });
    expect(await code(safeFetch(ctx, `${server.origin}/loop`))).toBe('FETCH');
    const big = await safeFetch(ctx, `${server.origin}/big`, { maxBytes: 100 });
    expect([big.body.byteLength, big.truncated]).toEqual([100, true]);
    expect(await code(safeFetch(ctx, `${server.origin}/slow`, { timeoutMs: 200 }))).toBe('FETCH');
  });

  it('sends the tool User-Agent by default', async () => {
    const res = await safeFetch(createContext({ allowPrivate: true }), `${server.origin}/ua`);
    expect(new TextDecoder().decode(res.body)).toMatch(/^site-audit\/\d+\.\d+\.\d+ \(\+https:\/\/github\.com\/BYDTechSolutions\/site-audit\)$/);
  });

  it('blocks loopback targets unless private targets are allowed', async () => {
    expect(await code(safeFetch(createContext(), `${server.origin}/c`))).toBe('BLOCKED');
    expect(await code(safeFetch(createContext(), 'http://localhost/'))).toBe('BLOCKED');
    expect(await code(safeFetch(createContext(), 'http://[::1]:8080/'))).toBe('BLOCKED');
  });

  it('re-checks every redirect: metadata IPs and names resolving to private IPs are blocked', async () => {
    expect((await safeFetch(publicCtx(), 'https://site.test/c')).status).toBe(200);
    expect(await code(safeFetch(publicCtx(), 'https://site.test/to-metadata'))).toBe('BLOCKED');
    expect(await code(safeFetch(publicCtx(), 'https://site.test/to-internal'))).toBe('BLOCKED');
    expect(await code(safeFetch(publicCtx(), 'https://site.test/to-file'))).toBe('INVALID_URL');
  });

  it('accepts only http(s) URLs without credentials', async () => {
    expect(await code(safeFetch(publicCtx(), 'ftp://site.test/'))).toBe('INVALID_URL');
    expect(await code(safeFetch(publicCtx(), 'https://user:pw@site.test/'))).toBe('INVALID_URL');
    expect(await code(safeFetch(publicCtx(), 'not a url'))).toBe('INVALID_URL');
  });
});
