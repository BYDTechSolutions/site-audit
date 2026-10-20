import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { gunzip, isGzip, isW3cDate, parseSitemap } from '../src/sitemap.js';

describe('sitemaps', () => {
  it('parses urlsets and indexes', () => {
    const set = parseSitemap('<?xml version="1.0"?><urlset xmlns="x"><url><loc>https://a.test/?a=1&amp;b=2</loc><lastmod>2026-01-02</lastmod></url><url><loc><![CDATA[https://a.test/b]]></loc></url></urlset>');
    expect(set).toEqual({ kind: 'urlset', entries: [{ loc: 'https://a.test/?a=1&b=2', lastmod: '2026-01-02' }, { loc: 'https://a.test/b', lastmod: null }] });
    expect(parseSitemap('<sitemapindex><sitemap><loc>https://a.test/s1.xml</loc></sitemap></sitemapindex>').kind).toBe('index');
    expect(parseSitemap('<html>nope</html>').kind).toBe('invalid');
  });

  it('gunzips with DecompressionStream and caps the output', async () => {
    const gz = new Uint8Array(gzipSync('<urlset></urlset>'));
    expect(isGzip(gz)).toBe(true);
    expect(new TextDecoder().decode((await gunzip(gz, 1000)).bytes)).toBe('<urlset></urlset>');
    expect((await gunzip(gz, 5)).truncated).toBe(true);
  });

  it('checks W3C Datetime', () => {
    for (const ok of ['2026', '2026-10', '2026-10-21', '2026-10-21T10:00:00Z', '2026-10-21T10:00+05:30']) expect(isW3cDate(ok)).toBe(true);
    for (const bad of ['21/10/2026', '2026-10-21 10:00', 'yesterday']) expect(isW3cDate(bad)).toBe(false);
  });
});
