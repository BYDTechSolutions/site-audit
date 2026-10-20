/*
 * Sitemap reading with web-standard APIs only: gzip through
 * DecompressionStream, XML through a tolerant regex reader that is enough for
 * <urlset> and <sitemapindex> files.
 */
import { decodeEntities } from './html.js';

/** One `<url>` or `<sitemap>` entry. */
export interface SitemapEntry {
  loc: string;
  lastmod: string | null;
}

/** A parsed sitemap file. */
export interface ParsedSitemap {
  kind: 'urlset' | 'index' | 'invalid';
  entries: SitemapEntry[];
}

function clean(value: string): string {
  return decodeEntities(value.replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '').trim());
}

/** Parses sitemap XML text. */
export function parseSitemap(xml: string): ParsedSitemap {
  const isIndex = /<(?:\w+:)?sitemapindex[\s>]/i.test(xml);
  const isSet = /<(?:\w+:)?urlset[\s>]/i.test(xml);
  if (!isIndex && !isSet) return { kind: 'invalid', entries: [] };
  const tag = isIndex ? 'sitemap' : 'url';
  const entries: SitemapEntry[] = [];
  const block = new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = block.exec(xml))) {
    const body = m[1] as string;
    const loc = /<(?:\w+:)?loc>([\s\S]*?)<\/(?:\w+:)?loc>/i.exec(body)?.[1];
    if (loc === undefined) continue;
    const lastmod = /<(?:\w+:)?lastmod>([\s\S]*?)<\/(?:\w+:)?lastmod>/i.exec(body)?.[1];
    entries.push({ loc: clean(loc), lastmod: lastmod === undefined ? null : clean(lastmod) });
  }
  return { kind: isIndex ? 'index' : 'urlset', entries };
}

/** True when bytes start with the gzip magic number. */
export function isGzip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** Gunzips with DecompressionStream, stopping at `maxBytes` of output. */
export async function gunzip(bytes: Uint8Array, maxBytes: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - size));
      size = maxBytes;
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
    size += value.byteLength;
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return { bytes: out, truncated };
}

/** W3C Datetime, the format sitemaps use: YYYY, YYYY-MM, YYYY-MM-DD, or a full date-time with zone. */
export function isW3cDate(value: string): boolean {
  return /^\d{4}(-\d{2}(-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?)?)?$/.test(value);
}
