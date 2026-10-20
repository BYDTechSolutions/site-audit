import { capList, type AuditContext } from '../context.js';
import { SOURCES } from '../facts/sources.js';
import { linksWithRel, tagsNamed } from '../html.js';
import { safeFetch } from '../net/fetcher.js';
import { robotsPath, robotsVerdict } from '../robots.js';

const AREA = 'indexability' as const;

function sameUrl(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    x.hash = '';
    y.hash = '';
    return x.href === y.href;
  } catch {
    return false;
  }
}

/** Robots directives that keep a page out of the index. */
function noindexIn(value: string): boolean {
  return value
    .toLowerCase()
    .split(/[,\s]+/)
    .some((d) => d === 'noindex' || d === 'none');
}

/** Status, redirects, noindex, robots.txt for Googlebot, canonical and hreflang. */
export async function checkIndexability(ctx: AuditContext): Promise<void> {
  const { page } = ctx;

  if (page.status >= 200 && page.status < 300) {
    ctx.pass(`${AREA}/status`, AREA, `Page answers ${page.status}`);
  } else {
    ctx.add({
      id: `${AREA}/status`, area: AREA, priority: 'fix-now', label: 'measured',
      title: `The page answers HTTP ${page.status}`,
      observed: `${page.url} returned status ${page.status}${page.redirects.length ? ` after ${page.redirects.length} redirect(s)` : ''}.`,
      why: 'Search engines only index pages that load successfully; visitors see an error instead of the page.',
      fix: 'Make the URL return 200 with the page, or redirect it permanently (301/308) to the page that replaced it.',
      source: SOURCES.googleRedirects,
    });
  }

  if (page.redirects.length >= 2) {
    ctx.add({
      id: `${AREA}/redirect-chain`, area: AREA, priority: 'nice-to-have', label: 'measured',
      title: `${page.redirects.length} redirects before the page loads`,
      observed: `The URL went through ${page.redirects.length} hops.`,
      why: 'Every hop is another round trip before the page starts loading; Lighthouse folds redirects into its document latency insight.',
      fix: 'Point links, the canonical URL and the sitemap at the final URL, and redirect old URLs straight to it in one hop.',
      source: SOURCES.lighthouseInsights,
      details: [...page.redirects.map((h) => `${h.status} ${h.url}`), `200 ${page.url}`],
    });
  }
  const temporary = page.redirects.filter((h) => h.status === 302 || h.status === 303 || h.status === 307);
  if (temporary.length) {
    ctx.add({
      id: `${AREA}/temporary-redirect`, area: AREA, priority: 'nice-to-have', label: 'measured',
      title: 'A temporary redirect leads to this page',
      observed: temporary.map((h) => `${h.status} from ${h.url}`).join('; '),
      why: 'Google shows the source of a temporary redirect in results and the target of a permanent one. If the move is permanent, a temporary redirect keeps the old URL in search.',
      fix: 'If the page has moved for good (for example http to https), use a 301 or 308 redirect. Leave it temporary only if it really is.',
      source: SOURCES.googleRedirects,
    });
  }

  // noindex: meta robots / googlebot, and the X-Robots-Tag header.
  const metaNoindex = tagsNamed(ctx.doc, 'meta').filter((t) => {
    const name = (t.attrs.name ?? '').toLowerCase();
    return (name === 'robots' || name === 'googlebot') && noindexIn(t.attrs.content ?? '');
  });
  const header = ctx.page.headers.get('x-robots-tag') ?? '';
  // "noindex", "googlebot: noindex" count; "otherbot: noindex" applies to another crawler only.
  let headerAgent = '';
  const headerNoindex = header.split(',').some((part) => {
    const m = /^\s*([a-z][\w-]*)\s*:\s*(.*)$/i.exec(part);
    let value = part;
    if (m && !/^unavailable_after$/i.test(m[1] as string)) {
      headerAgent = (m[1] as string).toLowerCase();
      value = m[2] as string;
    }
    return (headerAgent === '' || headerAgent === 'googlebot') && noindexIn(value);
  });
  const robots = await ctx.robotsFor(ctx.pageUrl.origin);
  const googleVerdict = robots.parsed ? robotsVerdict(robots.parsed, 'googlebot', robotsPath(ctx.pageUrl)) : null;

  if (metaNoindex.length || headerNoindex) {
    const where = [
      ...metaNoindex.map((t) => `<meta name="${t.attrs.name}" content="${t.attrs.content}">`),
      ...(headerNoindex ? [`X-Robots-Tag: ${header}`] : []),
    ];
    ctx.add({
      id: `${AREA}/noindex`, area: AREA, priority: 'fix-now', label: 'measured',
      title: 'The page asks search engines not to index it (noindex)',
      observed: where.join('; '),
      why: 'A noindex rule keeps the page out of Google Search entirely.',
      fix: 'Remove the noindex meta tag or X-Robots-Tag header if this page should appear in search. Keep it only on pages that must stay out.',
      source: SOURCES.googleNoindex,
      details: googleVerdict && !googleVerdict.allowed
        ? ['robots.txt also blocks Googlebot here, so Google cannot see the noindex: the URL may still be listed if other pages link to it.']
        : undefined,
    });
  } else {
    ctx.pass(`${AREA}/noindex`, AREA, 'No noindex rule');
  }

  if (googleVerdict && !googleVerdict.allowed) {
    ctx.add({
      id: `${AREA}/robots-blocked`, area: AREA, priority: 'fix-now', label: 'measured',
      title: 'robots.txt blocks Googlebot from this page',
      observed: `Rule "${googleVerdict.rule?.allow ? 'Allow' : 'Disallow'}: ${googleVerdict.rule?.pattern}" (line ${googleVerdict.rule?.line}) in the ${googleVerdict.group === '*' ? '"User-agent: *"' : `"User-agent: ${googleVerdict.group}"`} group of ${robots.url}.`,
      why: 'Googlebot will not crawl a URL robots.txt disallows, so its content cannot be read or ranked.',
      fix: 'Remove or narrow the Disallow rule, or add an Allow rule for this path, in the group Googlebot uses.',
      source: SOURCES.googleRobots,
    });
  } else if (googleVerdict) {
    ctx.pass(`${AREA}/robots-blocked`, AREA, 'robots.txt lets Googlebot crawl this page');
  }

  if (!ctx.isHtml) return;

  // Canonical: <link rel="canonical"> in the head, or a Link header.
  const canonTags = linksWithRel(ctx.doc, 'canonical');
  const linkHeader = ctx.page.headers.get('link') ?? '';
  const headerCanon = [...linkHeader.matchAll(/<([^>]+)>\s*;[^,]*rel="?canonical"?/gi)].map((m) => m[1] as string);
  const canonicals = [...canonTags.map((t) => t.attrs.href ?? ''), ...headerCanon];
  const distinct = [...new Set(canonicals.map((href) => { try { return new URL(href, ctx.page.url).href; } catch { return href; } }))];
  if (!canonicals.length) {
    ctx.add({
      id: `${AREA}/canonical-missing`, area: AREA, priority: 'nice-to-have', label: 'measured',
      title: 'No canonical URL',
      observed: 'No <link rel="canonical"> in the page and no canonical Link header.',
      why: 'A canonical tag is a strong signal of which URL Google should show when the same page is reachable at several addresses (with tracking parameters, with or without www).',
      fix: `Add <link rel="canonical" href="${ctx.page.url}"> to the <head>, with the absolute URL you want shown.`,
      source: SOURCES.googleCanonical,
    });
  } else if (distinct.length > 1) {
    ctx.add({
      id: `${AREA}/canonical-multiple`, area: AREA, priority: 'should-fix', label: 'measured',
      title: 'More than one canonical URL',
      observed: `${distinct.length} different canonical URLs are declared.`,
      why: 'Google advises against declaring different canonical URLs for the same page; conflicting signals may be ignored.',
      fix: 'Keep a single canonical, in either the HTML or the HTTP header.',
      source: SOURCES.googleCanonical,
      details: distinct,
    });
  } else {
    const href = canonicals[0] as string;
    const outside = canonTags.filter((t) => !t.inHead);
    if (outside.length) {
      ctx.add({
        id: `${AREA}/canonical-not-in-head`, area: AREA, priority: 'should-fix', label: 'measured',
        title: 'The canonical tag is outside <head>',
        observed: 'The <link rel="canonical"> appears after the head ended (in <body>, or after an element that closes the head).',
        why: 'Google only accepts rel="canonical" when it appears in the <head>.',
        fix: 'Move the tag into <head>, before any element that belongs in the body.',
        source: SOURCES.googleCanonical,
      });
    }
    if (!/^https?:\/\//i.test(href)) {
      ctx.add({
        id: `${AREA}/canonical-relative`, area: AREA, priority: 'nice-to-have', label: 'measured',
        title: 'The canonical URL is relative',
        observed: `href="${href}"`,
        why: 'Google recommends absolute URLs for rel="canonical"; relative ones work but can cause problems later.',
        fix: `Use the absolute URL: ${distinct[0]}`,
        source: SOURCES.googleCanonical,
      });
    }
    const target = distinct[0] as string;
    if (sameUrl(target, ctx.page.url)) {
      ctx.pass(`${AREA}/canonical`, AREA, 'Canonical URL points to this page');
    } else {
      let targetNote = '';
      let broken = false;
      if (/^https?:/.test(target) && (await ctx.mayFetch(target))) {
        try {
          const res = await safeFetch(ctx.net, target, { method: 'HEAD', noFollow: true });
          targetNote = ` It answers ${res.status}.`;
          broken = res.status >= 300;
        } catch (error) {
          targetNote = ` It could not be fetched (${(error as Error).message}).`;
          broken = true;
        }
      }
      ctx.add({
        id: broken ? `${AREA}/canonical-target-broken` : `${AREA}/canonical-other-url`,
        area: AREA,
        priority: broken ? 'should-fix' : 'nice-to-have',
        label: 'measured',
        title: broken ? 'The canonical URL does not load directly' : 'The canonical URL is a different page',
        observed: `Canonical: ${target}; this page: ${ctx.page.url}.${targetNote}`,
        why: broken
          ? 'A canonical that redirects or errors sends Google a conflicting signal about which URL to index.'
          : 'This page tells Google to index another URL instead. That is right for duplicates, wrong for a page that should rank on its own.',
        fix: broken
          ? 'Point the canonical at the final URL that answers 200.'
          : 'If this page should appear in search itself, make its canonical point to its own URL.',
        source: SOURCES.googleCanonical,
      });
    }
  }

  // hreflang annotations.
  const alternates = linksWithRel(ctx.doc, 'alternate').filter((t) => t.attrs.hreflang !== undefined);
  if (alternates.length) {
    const problems: string[] = [];
    let relative = 0;
    for (const alt of alternates) {
      const code = alt.attrs.hreflang ?? '';
      if (!/^(x-default|[a-z]{2}(-[a-z]{2})?)$/i.test(code)) problems.push(`hreflang="${code}" is not a two-letter language code (with an optional two-letter region) or x-default`);
      if (!/^https?:\/\//i.test(alt.attrs.href ?? '')) {
        relative++;
        problems.push(`hreflang="${code}" uses a non-absolute URL: ${alt.attrs.href ?? '(none)'}`);
      }
    }
    const selfListed = alternates.some((alt) => {
      try {
        return sameUrl(new URL(alt.attrs.href ?? '', ctx.page.url).href, ctx.page.url) || distinct.some((c) => sameUrl(new URL(alt.attrs.href ?? '', ctx.page.url).href, c));
      } catch {
        return false;
      }
    });
    if (!selfListed) problems.push('No hreflang entry points to this page itself; each language version must list itself as well as the others.');
    if (problems.length) {
      ctx.add({
        id: `${AREA}/hreflang`, area: AREA, priority: 'should-fix', label: 'measured',
        title: 'hreflang annotations have problems',
        observed: `${alternates.length} hreflang link(s); ${problems.length} problem(s)${relative ? `, ${relative} with non-absolute URLs` : ''}.`,
        why: 'Google ignores hreflang annotations that use invalid codes or non-absolute URLs, or that are not listed on every version of the page.',
        fix: 'Use ISO 639-1 language codes (optionally with an ISO 3166-1 alpha-2 region) or x-default, absolute URLs, and list every version, including this one, on each page.',
        source: SOURCES.googleHreflang,
        details: capList(problems),
      });
    } else {
      ctx.pass(`${AREA}/hreflang`, AREA, `${alternates.length} hreflang annotations look valid (return links on the other pages are not checked)`);
    }
  }
}
