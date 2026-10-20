/*
 * A small HTML tokenizer: the checks need start tags with their attributes,
 * whether a tag sits in <head>, and the text of <title> and <script>. They do
 * not need a DOM, so this stays dependency-free and runs anywhere. It does not
 * run scripts, so anything a page adds in the browser is not seen.
 */

/** A start tag. Names and attribute names are lowercase; values have entities decoded. */
export interface Tag {
  name: string;
  attrs: Record<string, string>;
  /** True while the parser is still in the document head. */
  inHead: boolean;
}

/** A `<script>` element with its text. */
export interface Script {
  attrs: Record<string, string>;
  text: string;
  inHead: boolean;
}

/** What the checks read from a page. */
export interface PageDoc {
  tags: Tag[];
  scripts: Script[];
  /** Text of every `<title>` element (only the head's count for SEO, but all are kept). */
  titles: { text: string; inHead: boolean }[];
  /** The `lang` attribute of `<html>`, if any. */
  lang: string | null;
}

const RAW_TEXT = new Set(['script', 'style', 'title', 'textarea', 'xmp']);
const HEAD_TAGS = new Set(['html', 'head', 'title', 'meta', 'link', 'script', 'style', 'base', 'noscript', 'template']);

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™',
  hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', middot: '·', bull: '•',
  laquo: '«', raquo: '»', euro: '€', pound: '£', yen: '¥', times: '×',
};

/** Decodes numeric entities and the common named ones. Unknown entities stay as written. */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);?/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return NAMED[body] ?? NAMED[body.toLowerCase()] ?? match;
  });
}

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const name = (m[1] as string).toLowerCase();
    if (name in attrs) continue; // the first occurrence wins, as in browsers
    attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

/** Tokenizes HTML into the parts the checks use. Never throws. */
export function parsePage(html: string): PageDoc {
  const doc: PageDoc = { tags: [], scripts: [], titles: [], lang: null };
  let inHead = true;
  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    const next = html[lt + 1] ?? '';
    if (next === '!' || next === '?') {
      const end = html.indexOf('>', lt);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (next === '/') {
      const end = html.indexOf('>', lt);
      const name = html.slice(lt + 2, end === -1 ? n : end).trim().toLowerCase();
      if (name === 'head') inHead = false;
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (!/[a-zA-Z]/.test(next)) {
      i = lt + 1;
      continue;
    }
    // Find the end of the start tag, skipping over quoted attribute values.
    let j = lt + 1;
    let quote: string | null = null;
    for (; j < n; j++) {
      const c = html[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '>') {
        break;
      }
    }
    const inner = html.slice(lt + 1, j);
    const nameMatch = /^[a-zA-Z][^\s/>]*/.exec(inner);
    const name = (nameMatch?.[0] ?? '').toLowerCase();
    const attrs = parseAttrs(inner.slice(name.length).replace(/\/\s*$/, ''));
    if (name === 'body' || (!HEAD_TAGS.has(name) && inHead)) inHead = false;
    if (name === 'html' && attrs.lang !== undefined) doc.lang = attrs.lang;
    doc.tags.push({ name, attrs, inHead });
    i = j + 1;
    if (RAW_TEXT.has(name) && !/\/\s*$/.test(inner)) {
      const closer = new RegExp(`</${name}`, 'gi');
      closer.lastIndex = i;
      const close = closer.exec(html)?.index ?? -1;
      const end = close === -1 ? n : close;
      const text = html.slice(i, end);
      if (name === 'script') doc.scripts.push({ attrs, text, inHead });
      if (name === 'title') doc.titles.push({ text: decodeEntities(text).replace(/\s+/g, ' ').trim(), inHead });
      const gt = close === -1 ? n : html.indexOf('>', close);
      i = gt === -1 ? n : gt + 1;
    }
  }
  return doc;
}

/** Start tags with this name. */
export function tagsNamed(doc: PageDoc, name: string): Tag[] {
  return doc.tags.filter((t) => t.name === name);
}

/** The `content` of `<meta name|property="key">`, first match, case-insensitive key. */
export function metaContent(doc: PageDoc, key: string): string | null {
  const wanted = key.toLowerCase();
  for (const tag of doc.tags) {
    if (tag.name !== 'meta') continue;
    const k = (tag.attrs.property ?? tag.attrs.name ?? '').toLowerCase();
    if (k === wanted) return tag.attrs.content ?? '';
  }
  return null;
}

/** `<link>` tags whose `rel` contains the given token. */
export function linksWithRel(doc: PageDoc, rel: string): Tag[] {
  return doc.tags.filter((t) => t.name === 'link' && (t.attrs.rel ?? '').toLowerCase().split(/\s+/).includes(rel));
}
