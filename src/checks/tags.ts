import type { AuditContext } from '../context.js';
import { TAG_SIGNATURES } from '../facts/tags.js';
import type { PageDoc } from '../html.js';
import type { DetectedTag } from '../types.js';

const AREA = 'tags' as const;
const URL_ATTRS = ['src', 'href', 'data', 'action'];

/** Finds known third-party tags in a parsed page. Pure, so it can be tested and reused. */
export function detectTags(doc: PageDoc): DetectedTag[] {
  const urls: string[] = [];
  for (const t of doc.tags) {
    if (!['script', 'iframe', 'img', 'link', 'embed', 'object', 'source'].includes(t.name)) continue;
    for (const a of URL_ATTRS) if (t.attrs[a]) urls.push(t.attrs[a] as string);
  }
  const inline = doc.scripts.filter((s) => !s.attrs.src && !/json/i.test(s.attrs.type ?? '')).map((s) => s.text);
  const sources = [...urls, ...inline];
  const lowered = sources.map((s) => s.toLowerCase());
  const found: DetectedTag[] = [];
  for (const sig of TAG_SIGNATURES) {
    let evidence = '';
    for (let i = 0; i < lowered.length && !evidence; i++) {
      const hit = sig.match.find((m) => (lowered[i] as string).includes(m));
      if (hit) evidence = i < urls.length ? (urls[i] as string).slice(0, 140) : `inline script mentioning ${hit}`;
    }
    if (!evidence) continue;
    const ids = new Set<string>();
    if (sig.ids) {
      for (const text of sources) {
        for (const m of text.matchAll(new RegExp(sig.ids.source, 'g'))) ids.add((m[1] ?? m[0]) as string);
      }
    }
    found.push({ id: sig.id, name: sig.name, category: sig.category, evidence, ids: [...ids].slice(0, 10) });
  }
  return found;
}

/** Lists the third-party tags the HTML loads. Informational: tags are listed, not judged. */
export async function checkTags(ctx: AuditContext): Promise<void> {
  if (!ctx.isHtml) return;
  const tags = detectTags(ctx.doc);
  ctx.data.tags = tags;
  ctx.note(AREA, tags.length
    ? `Found ${tags.length} known tag(s) in the HTML. Tags that a tag manager or another script adds later are not visible without running the page.`
    : 'No known tags in the HTML. Tags that a tag manager or another script adds later are not visible without running the page.');
}
