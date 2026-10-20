import { AREA_NAMES, LABEL_NAMES, PRIORITY_NAMES, type CrawlerRow, type Report } from '../types.js';
import { areaName, byPriority, counts, duration, NO_SCORE, probeCell, robotsCell } from './common.js';

const esc = (s: string | number | null | undefined) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const safeHref = (url: string) => (/^https?:\/\//i.test(url) ? esc(url) : '#');

const CSS = `
:root{--bg:#f7f7f5;--card:#fff;--ink:#1c1c1a;--muted:#5f5f5a;--line:#e3e2dd;--fix:#c62828;--fix-bg:#fdecea;--should:#a15c00;--should-bg:#fff4e0;--nice:#1f5f99;--nice-bg:#e8f1fb;--ok:#2e7d32;--ok-bg:#e8f5e9;--code:#f0efea}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--card:#1d1d1b;--ink:#ecebe6;--muted:#a9a8a1;--line:#33332f;--fix:#ff7b72;--fix-bg:#3a1d1b;--should:#f2b45a;--should-bg:#3a2c14;--nice:#79b8ff;--nice-bg:#16283b;--ok:#7ee787;--ok-bg:#16301b;--code:#262623}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:920px;margin:0 auto;padding:32px 16px 64px}h1{font-size:26px;margin:0 0 4px}h2{font-size:19px;margin:36px 0 12px}h3{font-size:16px;margin:0}
a{color:var(--nice)}.muted{color:var(--muted)}.url{word-break:break-all}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}.chip{border-radius:999px;padding:4px 12px;font-weight:600;font-size:14px}
.c-fix-now{background:var(--fix-bg);color:var(--fix)}.c-should-fix{background:var(--should-bg);color:var(--should)}.c-nice-to-have{background:var(--nice-bg);color:var(--nice)}.c-ok{background:var(--ok-bg);color:var(--ok)}
.legend{font-size:13px;color:var(--muted);border-left:3px solid var(--line);padding:4px 12px;margin:12px 0}
.card{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--line);border-radius:10px;padding:14px 16px;margin:10px 0}
.card.fix-now{border-left-color:var(--fix)}.card.should-fix{border-left-color:var(--should)}.card.nice-to-have{border-left-color:var(--nice)}
.badges{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 8px;font-size:12px}.badge{border:1px solid var(--line);border-radius:6px;padding:1px 7px;color:var(--muted)}
dl{margin:0;display:grid;grid-template-columns:max-content 1fr;gap:4px 12px}dt{font-weight:600;color:var(--muted)}dd{margin:0;overflow-wrap:anywhere}
ul.details{margin:8px 0 0;padding-left:18px;font-size:13px;color:var(--muted);overflow-wrap:anywhere}
.table-wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;background:var(--card);border:1px solid var(--line);border-radius:10px;font-size:14px}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);white-space:nowrap}th{color:var(--muted);font-weight:600}
td.bad{color:var(--fix);font-weight:600}td.good{color:var(--ok)}
.preview{display:flex;flex-direction:column;max-width:520px;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
.preview img{width:100%;aspect-ratio:1.91/1;object-fit:cover;display:block;background:var(--code)}
.preview .ph{aspect-ratio:1.91/1;display:flex;align-items:center;justify-content:center;background:var(--code);color:var(--muted);font-size:13px;padding:12px;text-align:center}
.preview .body{padding:10px 14px}.preview .host{font-size:12px;text-transform:uppercase;color:var(--muted)}.preview .t{font-weight:600}.preview .d{font-size:13px;color:var(--muted)}
.tags{display:flex;flex-wrap:wrap;gap:6px}.tag{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:2px 8px;font-size:13px}
details>summary{cursor:pointer;color:var(--muted)}footer{margin-top:40px;font-size:13px;color:var(--muted)}
`;

function crawlerRow(r: CrawlerRow): string {
  const visible = r.purpose === 'search' || r.purpose === 'user-fetch' || r.purpose === 'preview';
  const robots = robotsCell(r);
  const probe = probeCell(r);
  const robotsCls = r.robotsAllowed === false ? (visible ? 'bad' : '') : r.robotsAllowed ? 'good' : '';
  const probeCls = /BLOCKED|CHALLENGED/.test(probe) ? (visible ? 'bad' : '') : /ok/.test(probe) ? 'good' : '';
  return `<tr><td><a href="${safeHref(r.source.url)}">${esc(r.token)}</a></td><td>${esc(r.operator)}</td><td>${esc(r.purpose)}</td><td class="${robotsCls}">${esc(robots)}</td><td class="${probeCls}">${esc(probe)}</td></tr>`;
}

/** Renders a report as one self-contained HTML file: inline CSS, no scripts, no external requests. */
export function formatHtml(report: Report): string {
  const c = counts(report);
  const host = (() => {
    try {
      return new URL(report.finalUrl).host;
    } catch {
      return report.finalUrl;
    }
  })();
  const parts: string[] = [];
  parts.push(`<header><h1>Website audit: ${esc(host)}</h1><div class="muted url">${esc(report.url)}${report.finalUrl !== report.url ? ` → ${esc(report.finalUrl)}` : ''}</div>`);
  parts.push(`<div class="muted">${esc(report.startedAt.slice(0, 16).replace('T', ' '))} UTC · ${report.areas.length} areas · ${esc(duration(report.durationMs))}</div>`);
  parts.push(`<div class="chips"><span class="chip c-fix-now">${c['fix-now']} fix now</span><span class="chip c-should-fix">${c['should-fix']} should fix</span><span class="chip c-nice-to-have">${c['nice-to-have']} nice to have</span><span class="chip c-ok">${report.passed.length} passed</span></div>`);
  parts.push(`<p class="legend"><strong>Measured</strong>: observed on the site in this run. <strong>Google-documented</strong>: Google's own documentation says it matters. <strong>Optional / speculative</strong>: no search engine has confirmed it matters.</p></header>`);

  for (const { priority, findings } of byPriority(report)) {
    if (!findings.length) continue;
    parts.push(`<section><h2>${esc(PRIORITY_NAMES[priority])} (${findings.length})</h2>`);
    for (const f of findings) {
      parts.push(`<article class="card ${priority}"><h3>${esc(f.title)}</h3><div class="badges"><span class="badge">${esc(LABEL_NAMES[f.label])}</span><span class="badge">${esc(AREA_NAMES[f.area])}</span></div>`);
      parts.push(`<dl><dt>Saw</dt><dd>${esc(f.observed)}</dd><dt>Why</dt><dd>${esc(f.why)}</dd><dt>Fix</dt><dd>${esc(f.fix)}</dd><dt>Source</dt><dd><a href="${safeHref(f.source.url)}">${esc(f.source.title)}</a></dd></dl>`);
      if (f.details?.length) parts.push(`<ul class="details">${f.details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>`);
      parts.push('</article>');
    }
    parts.push('</section>');
  }
  if (!report.findings.length) parts.push('<p>Nothing to fix in the areas checked.</p>');

  const preview = report.data.preview;
  if (preview) {
    const img = preview.image;
    const media = img?.dataUrl
      ? `<img src="${esc(img.dataUrl)}" alt="${esc(img.alt ?? '')}">`
      : `<div class="ph">${img ? `Image not embedded${img.status ? ` (HTTP ${esc(img.status)})` : ''}: ${esc(img.url)}` : 'No share image (og:image)'}</div>`;
    let previewHost = host;
    try {
      previewHost = new URL(preview.url).host;
    } catch {
      // keep the page host
    }
    parts.push(`<section><h2>Link preview</h2><p class="muted">Roughly what a chat or social app shows when this URL is shared. Each app draws its own card.</p><div class="preview">${media}<div class="body"><div class="host">${esc(previewHost)}</div><div class="t">${esc(preview.title ?? '(no title)')}</div><div class="d">${esc(preview.description ?? '')}</div></div></div></section>`);
  }

  const crawlers = report.data.crawlers;
  if (crawlers?.length) {
    parts.push(`<section><h2>AI crawler access</h2><p class="muted">robots.txt verdict for this URL, and one request with each crawler's user agent. Probe results are indicative: real bots come from their own IP ranges. * = no full user agent is published; the probe sent one containing the token.</p><div class="table-wrap"><table><thead><tr><th>Crawler</th><th>Operator</th><th>Purpose</th><th>robots.txt</th><th>Probe</th></tr></thead><tbody>${crawlers.map(crawlerRow).join('')}</tbody></table></div></section>`);
  }

  for (const s of report.data.speed ?? []) {
    parts.push(`<section><h2>Speed (${esc(s.strategy)})</h2>`);
    if (s.error) {
      parts.push(`<p>Not measured: ${esc(s.error)}</p></section>`);
      continue;
    }
    parts.push(`<div class="table-wrap"><table><thead><tr><th>Lab metric (Lighthouse ${esc(s.lighthouseVersion ?? '')})</th><th>Value</th></tr></thead><tbody>${s.metrics.map((m) => `<tr><td>${esc(m.title)}</td><td class="${(m.score ?? 1) < 0.5 ? 'bad' : (m.score ?? 0) >= 0.9 ? 'good' : ''}">${esc(m.displayValue)}</td></tr>`).join('')}</tbody></table></div>`);
    if (s.field) {
      parts.push(`<p class="muted">Real users (${s.field.scope === 'page' ? 'this page' : 'whole site'}), Chrome UX Report, 75th percentile:</p><div class="table-wrap"><table><thead><tr><th>Metric</th><th>p75</th><th>Google's category</th></tr></thead><tbody>${s.field.metrics.map((m) => `<tr><td>${esc(m.name)}</td><td>${esc(m.percentile)}${m.key.endsWith('_MS') ? ' ms' : ''}</td><td class="${m.category === 'SLOW' ? 'bad' : m.category === 'FAST' ? 'good' : ''}">${esc(m.category)}</td></tr>`).join('')}</tbody></table></div>`);
    } else {
      parts.push('<p class="muted">Real users: not enough real-user traffic for field data.</p>');
    }
    parts.push('</section>');
  }

  const tags = report.data.tags;
  if (tags) {
    parts.push(`<section><h2>Installed tags (${tags.length})</h2>${tags.length ? `<div class="tags">${tags.map((t) => `<span class="tag" title="${esc(t.evidence)}">${esc(t.name)}${t.ids.length ? ` · ${esc(t.ids.join(', '))}` : ''} <span class="muted">${esc(t.category)}</span></span>`).join('')}</div>` : '<p class="muted">None of the known tags appear in the HTML.</p>'}</section>`);
  }
  const links = report.data.links;
  const sm = report.data.sitemaps;
  if (links || sm) {
    parts.push('<section><h2>Links, robots.txt and sitemaps</h2><ul>');
    if (links) parts.push(`<li>Links: ${links.found} found, ${links.checked} checked, ${links.ok} ok, ${links.broken} broken, ${links.unverified} unverified, ${links.skipped} skipped.</li>`);
    if (sm) parts.push(`<li>robots.txt: ${esc(sm.robotsTxt?.status ?? 'unreachable')}. Sitemaps read: ${sm.sitemaps.filter((x) => x.kind !== 'unreachable').length} of ${sm.sitemaps.length}. URLs listed: ${sm.totalUrls}.</li>`);
    parts.push('</ul></section>');
  }

  if (report.passed.length) {
    parts.push(`<section><h2>Passed (${report.passed.length})</h2><details><summary>Show the checks that passed</summary><ul>${report.passed.map((p) => `<li>${esc(p.title)} <span class="muted">(${esc(AREA_NAMES[p.area])})</span></li>`).join('')}</ul></details></section>`);
  }
  if (report.notes.length) {
    parts.push(`<section><h2>Notes</h2><ul>${report.notes.map((n) => `<li><strong>${esc(areaName(n.area))}:</strong> ${esc(n.message)}</li>`).join('')}</ul></section>`);
  }
  parts.push(`<footer><p>${esc(NO_SCORE)}</p><p>Generated by <a href="${safeHref(report.tool.url)}">${esc(report.tool.name)}</a> ${esc(report.tool.version)}.</p></footer>`);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Website audit: ${esc(host)}</title>
<style>${CSS}</style>
</head>
<body><main>
${parts.join('\n')}
</main></body>
</html>
`;
}
