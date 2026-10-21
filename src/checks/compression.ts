/*
 * Text compression, measured directly so it needs no PageSpeed key: the page
 * itself and its same-origin stylesheets and scripts. A text response with no
 * compression Content-Encoding is flagged when gzip would shrink it, using
 * Lighthouse's own cut-offs (responses under about 1.4 KiB, or saving under
 * 10%, are ignored). A `Cache-Control: no-transform` header gets named, since
 * it stops CDNs such as Cloudflare from compressing.
 */
import { capList, type AuditContext } from '../context.js';
import { SOURCES } from '../facts/sources.js';
import { safeFetch } from '../net/fetcher.js';
import { isLocalDevHost } from '../net/ip.js';

const AREA = 'speed' as const;
/** Lighthouse ignores responses smaller than this. */
const MIN_BYTES = 1400;
/** …and responses where gzip saves less than this share. */
const MIN_SAVING = 0.1;
/** Encodings that count as compressed (Lighthouse counts br, gzip, deflate; zstd is newer and just as real). */
const COMPRESSED = new Set(['br', 'gzip', 'deflate', 'zstd']);
const MAX_RESOURCES = 8;
/** An uncompressed page at least this large is worth fixing before the rest. */
const BIG_BYTES = 50_000;

const TEXT_TYPE = /^(text\/|application\/(javascript|x-javascript|ecmascript|json|ld\+json|xml|xhtml\+xml|manifest\+json)|image\/svg\+xml)/i;

/** The compressed size gzip would give, or null where CompressionStream is missing. */
export async function gzipSize(body: Uint8Array): Promise<number | null> {
  if (typeof CompressionStream === 'undefined') return null;
  const stream = new Blob([new Uint8Array(body)]).stream().pipeThrough(new CompressionStream('gzip'));
  const reader = stream.getReader();
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
  }
  return size;
}

/** `Content-Encoding` names one or more codings, applied in order. */
export function isCompressed(contentEncoding: string | null): boolean {
  return (contentEncoding ?? '')
    .toLowerCase()
    .split(',')
    .map((c) => c.trim())
    .some((c) => COMPRESSED.has(c));
}

function kb(bytes: number): string {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(bytes >= 10_240 ? 0 : 1)} KB` : `${bytes} B`;
}

interface Uncompressed {
  url: string;
  bytes: number;
  gzip: number | null;
  noTransform: boolean;
}

/** Whether a response is a text response that should have been compressed. */
async function judge(url: string, headers: Headers, contentType: string, body: Uint8Array, truncated: boolean): Promise<Uncompressed | null> {
  if (!TEXT_TYPE.test(contentType) || body.byteLength < MIN_BYTES) return null;
  if (isCompressed(headers.get('content-encoding'))) return null;
  const gzip = truncated ? null : await gzipSize(body);
  if (gzip !== null && 1 - gzip / body.byteLength < MIN_SAVING) return null;
  const noTransform = /(^|,)\s*no-transform\s*(,|$)/i.test(headers.get('cache-control') ?? '');
  return { url, bytes: body.byteLength, gzip, noTransform };
}

/** Same-origin stylesheets and scripts the page loads, in document order. */
function textResources(ctx: AuditContext): string[] {
  const urls = new Set<string>();
  const add = (href: string | undefined) => {
    if (!href) return;
    try {
      const u = new URL(href, ctx.pageUrl);
      u.hash = '';
      if (u.origin === ctx.pageUrl.origin && (u.protocol === 'http:' || u.protocol === 'https:')) urls.add(u.href);
    } catch {
      // not a URL
    }
  };
  for (const tag of ctx.doc.tags) {
    if (tag.name !== 'link') continue;
    const rel = (tag.attrs.rel ?? '').toLowerCase().split(/\s+/);
    if (rel.includes('stylesheet') || (rel.includes('preload') && /^(style|script)$/i.test(tag.attrs.as ?? ''))) add(tag.attrs.href);
  }
  for (const script of ctx.doc.scripts) add(script.attrs.src);
  return [...urls];
}

/** Flags text that arrives uncompressed. */
export async function checkCompression(ctx: AuditContext): Promise<void> {
  // Dev servers rarely compress and production hosts usually do, so on localhost these are reminders, not fixes.
  const local = isLocalDevHost(ctx.pageUrl.hostname);
  const priorityFor = (bytes: number) => (!local && bytes >= BIG_BYTES ? 'should-fix' : 'nice-to-have');
  if (local) ctx.note(AREA, 'Compression was measured on a local server; most dev servers do not compress, so re-check it on the deployed site.');
  const page = await judge(ctx.page.url, ctx.page.headers, ctx.page.contentType, ctx.page.body, ctx.page.truncated);
  if (page) {
    const smaller = page.gzip !== null ? ` With gzip it would be about ${kb(page.gzip)}.` : '';
    ctx.add({
      id: 'speed/uncompressed-document',
      area: AREA,
      priority: priorityFor(page.bytes),
      label: 'measured',
      title: `The page arrives uncompressed (${kb(page.bytes)})`,
      observed: `The HTML came back with no Content-Encoding (br, gzip or zstd), ${kb(page.bytes)} on the wire.${smaller}${page.noTransform ? ' Its Cache-Control includes no-transform.' : ''}`,
      why: 'Every uncompressed byte has to arrive before the browser can parse and paint the page, so first and largest paint come later, most on slow mobile connections. Text usually shrinks by 60–90%.',
      fix: page.noTransform
        ? 'Remove no-transform from Cache-Control on HTML: it tells CDNs such as Cloudflare not to compress the response. If it was added to stop the CDN injecting a script, turn that feature off at the CDN instead.'
        : 'Turn on Brotli (preferred) or gzip for text responses on the server or CDN, and confirm the Content-Encoding header in DevTools.',
      source: page.noTransform ? SOURCES.cloudflareCompression : SOURCES.lighthouseTextCompression,
    });
  } else if (ctx.isHtml && ctx.page.body.byteLength >= MIN_BYTES) {
    ctx.pass('speed/compressed-document', AREA, `The page is compressed (${ctx.page.headers.get('content-encoding')})`);
  }

  const urls = textResources(ctx);
  const checked = urls.slice(0, MAX_RESOURCES);
  if (urls.length > MAX_RESOURCES) ctx.note(AREA, `Checked compression on the first ${MAX_RESOURCES} of ${urls.length} same-origin stylesheets and scripts.`);
  const failures: Uncompressed[] = [];
  let measured = 0;
  for (const url of checked) {
    try {
      const res = await safeFetch(ctx.net, url, { maxBytes: 3_000_000 });
      if (res.status !== 200) continue;
      measured += 1;
      const bad = await judge(res.url, res.headers, res.contentType, res.body, res.truncated);
      if (bad) failures.push(bad);
    } catch {
      // A resource that cannot be fetched is the links check's business, not this one.
    }
  }
  if (failures.length) {
    const total = failures.reduce((sum, f) => sum + f.bytes, 0);
    const noTransform = failures.some((f) => f.noTransform);
    ctx.add({
      id: 'speed/uncompressed-resources',
      area: AREA,
      priority: priorityFor(total),
      label: 'measured',
      title: `${failures.length} stylesheet or script file(s) arrive uncompressed (${kb(total)})`,
      observed: `Same-origin files with no compression Content-Encoding, ${kb(total)} in all.`,
      why: 'Stylesheets and scripts in the head block the first paint until they arrive; compressed, they usually shrink by 60–90%.',
      fix: noTransform
        ? 'Remove no-transform from Cache-Control on these files so the CDN can compress them, or enable Brotli/gzip at the origin.'
        : 'Turn on Brotli (preferred) or gzip for CSS and JavaScript on the server or CDN.',
      source: noTransform ? SOURCES.cloudflareCompression : SOURCES.lighthouseTextCompression,
      details: capList(failures.map((f) => `${f.url} — ${kb(f.bytes)}${f.gzip !== null ? `, about ${kb(f.gzip)} gzipped` : ''}`), 5),
    });
  } else if (measured) {
    ctx.pass('speed/compressed-resources', AREA, `${measured} same-origin stylesheet/script file(s) arrive compressed`);
  }
}
