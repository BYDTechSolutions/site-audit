import { clip, type AuditContext } from '../context.js';
import { SOURCES } from '../facts/sources.js';
import { tagsNamed } from '../html.js';
import { imageSize, toBase64 } from '../image.js';
import { safeFetch } from '../net/fetcher.js';
import type { SharePreview } from '../types.js';

const AREA = 'meta' as const;

/** Above these lengths we say "likely truncated". Google sets no limit; these are our heuristics, and the finding says so. */
const TITLE_HEURISTIC = 120;
const DESCRIPTION_HEURISTIC = 320;
/** Images up to this size are embedded in the HTML report. */
const EMBED_MAX_BYTES = 800_000;

/** Title, meta description, Open Graph tags, and the share-card preview. */
export async function checkMeta(ctx: AuditContext): Promise<void> {
  if (!ctx.isHtml) return;
  const { doc } = ctx;

  const titles = doc.titles.filter((t) => t.inHead);
  const title = titles[0]?.text ?? '';
  if (!titles.length || !title) {
    ctx.add({
      id: `${AREA}/title-missing`, area: AREA, priority: 'fix-now', label: 'measured',
      title: titles.length ? 'The <title> is empty' : 'The page has no <title>',
      observed: titles.length ? '<title></title> is empty.' : 'No <title> element in the <head>.',
      why: 'Google asks for a title on every page; without one it builds the title link from other text on the page, and browser tabs and bookmarks show the URL.',
      fix: 'Add a short, specific <title> in the <head> that says what this page is.',
      source: SOURCES.googleTitle,
    });
  } else {
    if (titles.length > 1) {
      ctx.add({
        id: `${AREA}/title-multiple`, area: AREA, priority: 'should-fix', label: 'measured',
        title: `${titles.length} <title> elements in the head`,
        observed: titles.map((t) => `"${clip(t.text, 80)}"`).join(', '),
        why: 'Only one title is used; duplicates usually mean two templates or plugins are both writing one, and the wrong one may win.',
        fix: 'Keep a single <title>.',
        source: SOURCES.googleTitle,
      });
    }
    if (title.length > TITLE_HEURISTIC) {
      ctx.add({
        id: `${AREA}/title-long`, area: AREA, priority: 'nice-to-have', label: 'measured',
        title: `The title is long (${title.length} characters)`,
        observed: `"${clip(title, 160)}"`,
        why: `Google sets no length limit but truncates title links to fit the device width and advises against unnecessarily long or verbose text. (We flag titles over ${TITLE_HEURISTIC} characters; that number is our heuristic, not Google's.)`,
        fix: 'Put the words that identify the page first and trim the rest.',
        source: SOURCES.googleTitle,
      });
    } else {
      ctx.pass(`${AREA}/title`, AREA, `Title present (${title.length} characters)`);
    }
  }

  const descriptions = tagsNamed(doc, 'meta').filter((t) => (t.attrs.name ?? '').toLowerCase() === 'description');
  const description = (descriptions[0]?.attrs.content ?? '').trim();
  if (!descriptions.length || !description) {
    ctx.add({
      id: `${AREA}/description-missing`, area: AREA, priority: 'nice-to-have', label: 'measured',
      title: descriptions.length ? 'The meta description is empty' : 'No meta description',
      observed: descriptions.length ? '<meta name="description" content=""> is empty.' : 'No <meta name="description"> in the page.',
      why: 'Google builds snippets mostly from page content, but sometimes uses the meta description when it describes the page better.',
      fix: 'Add a unique <meta name="description"> that summarizes this page in a sentence or two.',
      source: SOURCES.googleSnippet,
    });
  } else {
    if (descriptions.length > 1) {
      ctx.add({
        id: `${AREA}/description-multiple`, area: AREA, priority: 'nice-to-have', label: 'measured',
        title: `${descriptions.length} meta descriptions`,
        observed: descriptions.map((t) => `"${clip(t.attrs.content ?? '', 60)}"`).join(', '),
        why: 'Duplicates usually mean two templates or plugins both write one; which one is used is not up to you.',
        fix: 'Keep a single meta description.',
        source: SOURCES.googleSnippet,
      });
    }
    if (description.length > DESCRIPTION_HEURISTIC) {
      ctx.add({
        id: `${AREA}/description-long`, area: AREA, priority: 'nice-to-have', label: 'measured',
        title: `The meta description is long (${description.length} characters)`,
        observed: `"${clip(description, 160)}"`,
        why: `Google sets no length limit but truncates snippets to fit the device width. (Over ${DESCRIPTION_HEURISTIC} characters is our heuristic, not Google's.)`,
        fix: 'Lead with what the reader gets from the page.',
        source: SOURCES.googleSnippet,
      });
    } else {
      ctx.pass(`${AREA}/description`, AREA, `Meta description present (${description.length} characters)`);
    }
  }

  // Open Graph and Twitter tags, as written.
  const tags: Record<string, string> = {};
  for (const t of tagsNamed(doc, 'meta')) {
    const key = (t.attrs.property ?? t.attrs.name ?? '').toLowerCase();
    if ((key.startsWith('og:') || key.startsWith('twitter:')) && !(key in tags)) tags[key] = t.attrs.content ?? '';
  }
  const required = ['og:title', 'og:type', 'og:image', 'og:url'];
  const missing = required.filter((k) => !tags[k]);
  if (missing.length) {
    const important = missing.includes('og:image') || missing.includes('og:title');
    ctx.add({
      id: `${AREA}/og-missing`, area: AREA, priority: important ? 'should-fix' : 'nice-to-have', label: 'measured',
      title: `Open Graph tags missing: ${missing.join(', ')}`,
      observed: `Found: ${Object.keys(tags).filter((k) => k.startsWith('og:')).join(', ') || 'no og: tags'}.`,
      why: 'The Open Graph protocol lists og:title, og:type, og:image and og:url as required. Apps that build link previews read these tags; without them the preview is guessed or bare.',
      fix: `Add the missing tags to the <head>, e.g. <meta property="og:image" content="https://…/share.png">.`,
      source: SOURCES.ogp,
    });
  } else {
    ctx.pass(`${AREA}/og`, AREA, 'The four required Open Graph tags are present');
  }

  const preview: SharePreview = {
    title: tags['og:title'] || tags['twitter:title'] || title || null,
    description: tags['og:description'] || tags['twitter:description'] || description || null,
    siteName: tags['og:site_name'] || null,
    url: tags['og:url'] || ctx.page.url,
    image: null,
    tags,
  };

  const imageRaw = tags['og:image'] || tags['twitter:image'] || '';
  if (imageRaw) {
    const absolute = /^https?:\/\//i.test(imageRaw);
    let imageUrl: string | null = null;
    try {
      imageUrl = new URL(imageRaw, ctx.page.url).href;
    } catch {
      imageUrl = null;
    }
    if (!absolute && tags['og:image']) {
      ctx.add({
        id: `${AREA}/og-image-relative`, area: AREA, priority: 'should-fix', label: 'measured',
        title: 'og:image is not an absolute URL',
        observed: `content="${imageRaw}"`,
        why: 'Open Graph values are URLs read by other companies\' servers, outside your page; a relative path has no page to resolve against there.',
        fix: imageUrl ? `Use the full URL: ${imageUrl}` : 'Use a full https:// URL for the image.',
        source: SOURCES.ogp,
      });
    }
    const alt = tags['og:image:alt'] || tags['twitter:image:alt'] || null;
    preview.image = { url: imageUrl ?? imageRaw, alt, status: null, contentType: null, width: null, height: null, bytes: null, dataUrl: null };
    if (imageUrl && /^https?:/.test(imageUrl)) {
      if (!(await ctx.mayFetch(imageUrl))) {
        ctx.note(AREA, `Did not fetch the share image: robots.txt on ${new URL(imageUrl).host} disallows this tool.`);
      } else {
        try {
          const res = await safeFetch(ctx.net, imageUrl, { accept: 'image/*', maxBytes: 5_000_000 });
          const size = imageSize(res.body);
          Object.assign(preview.image, {
            status: res.status,
            contentType: res.contentType || null,
            width: size?.width ?? null,
            height: size?.height ?? null,
            bytes: res.truncated ? null : res.body.byteLength,
          });
          const okImage = res.status >= 200 && res.status < 300 && res.contentType.startsWith('image/');
          if (okImage && !res.truncated && res.body.byteLength <= EMBED_MAX_BYTES) {
            preview.image.dataUrl = `data:${res.contentType.split(';')[0]};base64,${toBase64(res.body)}`;
          }
          if (!okImage) {
            ctx.add({
              id: `${AREA}/og-image-broken`, area: AREA, priority: 'should-fix', label: 'measured',
              title: 'The share image does not load as an image',
              observed: `${imageUrl} answered ${res.status}${res.contentType ? ` with ${res.contentType}` : ''}.`,
              why: 'Link previews show no image when the URL errors or does not return an image.',
              fix: 'Point og:image at a public image URL that answers 200 with an image content type.',
              source: SOURCES.ogp,
            });
          } else {
            ctx.pass(`${AREA}/og-image`, AREA, `Share image loads${size ? ` (${size.width}×${size.height})` : ''}`);
          }
        } catch (error) {
          ctx.add({
            id: `${AREA}/og-image-broken`, area: AREA, priority: 'should-fix', label: 'measured',
            title: 'The share image could not be fetched',
            observed: (error as Error).message,
            why: 'Link previews show no image when the URL cannot be reached.',
            fix: 'Point og:image at a public image URL that answers 200 with an image content type.',
            source: SOURCES.ogp,
          });
        }
      }
    }
    if (tags['og:image'] && !alt) {
      ctx.add({
        id: `${AREA}/og-image-alt`, area: AREA, priority: 'nice-to-have', label: 'measured',
        title: 'og:image has no og:image:alt',
        observed: 'No og:image:alt tag.',
        why: 'The Open Graph protocol says a page with og:image should describe it in og:image:alt, for people who cannot see the image.',
        fix: 'Add <meta property="og:image:alt" content="what the image shows">.',
        source: SOURCES.ogp,
      });
    }
  }
  ctx.data.preview = preview;
}
