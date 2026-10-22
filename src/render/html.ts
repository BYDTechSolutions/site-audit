import { psiReportUrl } from '../checks/psi.js';
import { labThreshold, rateLabMetric, rateLighthouseScore, type Rating } from '../facts/cwv.js';
import { AREA_NAMES, LABEL_NAMES, PRIORITY_NAMES, type CrawlerRow, type InsightDetail, type LabMetric, type Report, type SpeedResult } from '../types.js';
import { areaName, byPriority, cellText, counts, duration, isNumberColumn, footerLine, probeCell, robotsCell, savingsText, scoreNote, scoreItems, type ScoreItem } from './common.js';

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
.speed-note{font-size:13px;color:var(--muted);margin:4px 0 12px}h4{font-size:15px;margin:20px 0 8px}
.tab-panel .tab-title{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.tab-input{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}
.tab-labels{display:flex;gap:6px;border-bottom:1px solid var(--line);margin:8px 0 16px}
.tab-labels label{cursor:pointer;padding:8px 16px;border:1px solid transparent;border-bottom:none;border-radius:8px 8px 0 0;color:var(--muted);font-weight:600;margin-bottom:-1px}
.tab-panel{display:none}
#speed-tab-mobile:checked~.tab-labels label[for=speed-tab-mobile],#speed-tab-desktop:checked~.tab-labels label[for=speed-tab-desktop]{background:var(--card);border-color:var(--line);color:var(--ink)}
#speed-tab-mobile:focus-visible~.tab-labels label[for=speed-tab-mobile],#speed-tab-desktop:focus-visible~.tab-labels label[for=speed-tab-desktop]{outline:2px solid var(--nice);outline-offset:2px}
#speed-tab-mobile:checked~.panel-mobile,#speed-tab-desktop:checked~.panel-desktop,.tab-panel.only{display:block}
.r-good{--c:var(--ok)}.r-needs-improvement{--c:var(--should)}.r-poor{--c:var(--fix)}
.scores{display:flex;flex-wrap:wrap;gap:24px;margin:8px 0}.score{margin:0;text-align:center;width:120px}
.strips{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 14px;margin:12px 0}.strip{display:flex;flex-wrap:wrap;align-items:center;gap:14px;margin:4px 0}
.strip-label{font-weight:600;width:64px}.mini{display:inline-flex;align-items:center;gap:6px;font-size:13px}
.mini .ring{width:40px;height:40px;margin:0}.mini .ring span{width:32px;height:32px;font-size:13px}.ring.frac span{font-size:22px}.mini .ring.frac span{font-size:11px}
.ring{width:96px;height:96px;margin:0 auto 6px;border-radius:50%;background:conic-gradient(var(--c) calc(var(--p)*1%),var(--line) 0);display:flex;align-items:center;justify-content:center}
.ring span{width:78px;height:78px;border-radius:50%;background:var(--card);display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;color:var(--c)}
.score figcaption{font-weight:600}.score small{display:block;color:var(--muted);font-weight:400;font-size:12px}
.metrics{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin:12px 0}
.metric{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px}
.metric .mt{font-size:13px;color:var(--muted)}.metric .mv{font-size:24px;font-weight:700;color:var(--c,var(--ink))}.metric .mr{font-size:12px;color:var(--muted)}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--c,var(--line));margin-right:6px}
.bar{position:relative;display:flex;height:6px;border-radius:3px;overflow:hidden;margin:6px 0 2px}.bar i{display:block;height:100%}
.bar .z-good{background:var(--ok)}.bar .z-needs-improvement{background:var(--should)}.bar .z-poor{background:var(--fix)}
.bar b{position:absolute;top:-3px;width:3px;height:12px;background:var(--ink);border-radius:1px}
.filmstrip{display:flex;gap:8px;overflow-x:auto;padding-bottom:6px}.filmstrip figure{margin:0;flex:0 0 auto;text-align:center;font-size:12px;color:var(--muted)}
.filmstrip img{display:block;height:140px;width:auto;border:1px solid var(--line);border-radius:6px;background:var(--code)}
.shots{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}.shots figure{margin:0;font-size:12px;color:var(--muted)}
.shots img.final{display:block;max-width:240px;max-height:480px;border:1px solid var(--line);border-radius:8px;background:var(--code)}
.fullpage{max-height:480px;width:260px;overflow-y:auto;border:1px solid var(--line);border-radius:8px;background:var(--code)}.fullpage img{display:block;width:100%;height:auto}
details.insight{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 14px;margin:8px 0}
details.insight>summary{color:var(--ink)}details.insight>summary .muted{font-size:13px}
details.insight p{margin:8px 0}details.insight table{font-size:13px}details.insight td{white-space:normal;overflow-wrap:anywhere;min-width:60px}
td.num,th.num{text-align:right;white-space:nowrap}
`;

function crawlerRow(r: CrawlerRow): string {
  const visible = r.purpose === 'search' || r.purpose === 'user-fetch' || r.purpose === 'preview';
  const robots = robotsCell(r);
  const probe = probeCell(r);
  const robotsCls = r.robotsAllowed === false ? (visible ? 'bad' : '') : r.robotsAllowed ? 'good' : '';
  const probeCls = /BLOCKED|CHALLENGED/.test(probe) ? (visible ? 'bad' : '') : /ok/.test(probe) ? 'good' : '';
  return `<tr><td><a href="${safeHref(r.source.url)}">${esc(r.token)}</a></td><td>${esc(r.operator)}</td><td>${esc(r.purpose)}</td><td class="${robotsCls}">${esc(robots)}</td><td class="${probeCls}">${esc(probe)}</td></tr>`;
}

const RATING_NAMES: Record<Rating, string> = { good: 'Good', 'needs-improvement': 'Needs improvement', poor: 'Poor' };

/** What a screen reader hears for one score. */
function scoreLabel(item: ScoreItem, r: Rating): string {
  return item.fraction
    ? `${item.name}: ${item.fraction.passed} of ${item.fraction.total} audits passed (${RATING_NAMES[r]})`
    : `${item.name}: ${item.value} out of 100 (${RATING_NAMES[r]})`;
}

/** One of Google's category scores as a ring, colored by Lighthouse's bands. `p` is a number we computed, never page text. */
function scoreRing(item: ScoreItem, size: 'big' | 'mini' = 'big'): string {
  const p = Math.max(0, Math.min(100, Math.round(item.value)));
  const r = rateLighthouseScore(p / 100);
  const ring = `<div class="ring${item.fraction ? ' frac' : ''}" role="img" aria-label="${esc(scoreLabel(item, r))}"><span>${esc(item.text)}</span></div>`;
  return size === 'mini'
    ? `<span class="mini r-${r}" style="--p:${p}">${ring}<span class="mini-name">${esc(item.name)}</span></span>`
    : `<figure class="score r-${r}" style="--p:${p}">${ring}<figcaption>${esc(item.name)}<small>${item.fraction ? 'audits passed, ' : ''}Google Lighthouse lab score</small></figcaption></figure>`;
}

/** The compact score row under the summary: Google's scores per strategy, before the fix list. */
function scoreStrip(speed: SpeedResult[]): string {
  const rows = speed
    .filter((s) => !s.error)
    .map((s) => ({ s, items: scoreItems(s) }))
    .filter((x) => x.items.length)
    .map(({ s, items }) => `<div class="strip"><span class="strip-label">${s.strategy === 'mobile' ? 'Mobile' : 'Desktop'}</span>${items.map((i) => scoreRing(i, 'mini')).join('')}</div>`);
  return rows.length ? `<div class="strips">${rows.join('')}<p class="speed-note">${esc(scoreNote('below'))} <a href="#speed">Details in the speed section</a>.</p></div>` : '';
}

/** One lab metric as a card: colored by Google's Core Web Vitals threshold where the metric has one, else by Lighthouse's metric score. */
function metricCard(m: LabMetric): string {
  const rated = rateLabMetric(m.id, m.numericValue, m.score);
  const cls = rated ? ` r-${rated.rating}` : '';
  let bar = '';
  const cwv = rated?.basis === 'core-web-vitals' ? labThreshold(m.id) : undefined;
  if (cwv && typeof m.numericValue === 'number') {
    const max = cwv.poor * 1.5;
    const pct = (v: number) => Math.max(0, Math.min(100, (v / max) * 100)).toFixed(1);
    bar = `<div class="bar" aria-hidden="true"><i class="z-good" style="width:${pct(cwv.good)}%"></i><i class="z-needs-improvement" style="width:${(Number(pct(cwv.poor)) - Number(pct(cwv.good))).toFixed(1)}%"></i><i class="z-poor" style="flex:1"></i><b style="left:calc(${pct(m.numericValue)}% - 1px)"></b></div>`;
  }
  const basis = rated ? `${RATING_NAMES[rated.rating]} (${rated.basis === 'core-web-vitals' ? 'Core Web Vitals threshold' : 'Lighthouse metric score'})` : '';
  return `<div class="metric${cls}"><div class="mt"><span class="dot" aria-hidden="true"></span>${esc(m.title)}</div><div class="mv">${esc(m.displayValue || '—')}</div>${bar}<div class="mr">${esc(basis)}</div></div>`;
}

function insightBlock(i: InsightDetail, reportUrl: string): string {
  const savings = savingsText(i.metricSavings);
  const parts = [`<details class="insight"><summary><strong>${esc(i.title)}</strong>${i.displayValue ? ` — ${esc(i.displayValue)}` : ''}${savings ? ` <span class="muted">(${esc(savings)})</span>` : ''}</summary>`];
  if (i.description) parts.push(`<p>${esc(i.description)}</p>`);
  parts.push(`<p class="muted">${i.group === 'diagnostics' ? 'Diagnostic' : 'Insight'}${savings ? ` · estimated savings ${esc(savings)}` : ''} · <a href="${safeHref(i.source.url)}">${esc(i.source.title)}</a></p>`);
  const t = i.table;
  if (t) {
    const head = t.columns.map((c) => `<th${isNumberColumn(c) ? ' class="num"' : ''}>${esc(c.label)}</th>`).join('');
    const body = t.rows.map((row, n) => `<tr>${t.columns.map((c) => {
      const text = cellText(c, row[c.key]);
      const full = t.fullUrls[n]?.[c.key];
      const content = full && text ? `<a href="${safeHref(full)}" title="${esc(full)}">${esc(text)}</a>` : esc(text);
      return `<td${isNumberColumn(c) ? ' class="num"' : ''}>${content}</td>`;
    }).join('')}</tr>`).join('');
    parts.push(`<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`);
    if (t.moreRows) parts.push(`<p class="muted">${t.moreRows} more row(s) in the <a href="${safeHref(reportUrl)}">full PageSpeed Insights trace</a>.</p>`);
  }
  parts.push('</details>');
  return parts.join('');
}

function speedPanel(s: SpeedResult, finalUrl: string): string {
  const parts: string[] = [];
  if (s.error) return `<p>Not measured: ${esc(s.error)}</p>`;
  const scores = scoreItems(s).map((i) => scoreRing(i));
  if (scores.length) {
    parts.push(`<div class="scores">${scores.join('')}</div>`);
    parts.push(`<p class="speed-note">Google Lighthouse lab score, one simulated ${esc(s.strategy)} load${s.lighthouseVersion ? ` (Lighthouse ${esc(s.lighthouseVersion)})` : ''}. 90–100 good, 50–89 needs improvement, 0–49 poor.${s.scoreSource ? ` <a href="${safeHref(s.scoreSource.url)}">How Google scores it</a>.` : ''}</p>`);
  }
  if (s.metrics.length) parts.push(`<h4>Lab metrics${s.lighthouseVersion && !scores.length ? ` (Lighthouse ${esc(s.lighthouseVersion)})` : ''}</h4><div class="metrics">${s.metrics.map(metricCard).join('')}</div>`);
  if (s.field) {
    parts.push(`<p class="muted">Real users (${s.field.scope === 'page' ? 'this page' : 'whole site'}), Chrome UX Report, 75th percentile:</p><div class="table-wrap"><table><thead><tr><th>Metric</th><th>p75</th><th>Google's category</th></tr></thead><tbody>${s.field.metrics.map((m) => `<tr><td>${esc(m.name)}</td><td>${esc(m.percentile)}${m.key.endsWith('_MS') ? ' ms' : ''}</td><td class="${m.category === 'SLOW' ? 'bad' : m.category === 'FAST' ? 'good' : ''}">${esc(m.category)}</td></tr>`).join('')}</tbody></table></div>`);
  } else {
    parts.push('<p class="muted">Real users: not enough real-user traffic for field data.</p>');
  }
  const shots = s.screenshots;
  if (shots?.filmstrip?.length) {
    parts.push(`<h4>How the page loaded</h4><div class="filmstrip">${shots.filmstrip.map((f) => `<figure><img src="${esc(f.img.dataUri)}" alt="${esc(`Frame at ${duration(f.timingMs)}`)}" loading="lazy"><figcaption>${esc(duration(f.timingMs))}</figcaption></figure>`).join('')}</div>`);
  }
  if (shots?.final || shots?.fullPage) {
    const figs: string[] = [];
    if (shots.final) figs.push(`<figure><img class="final" src="${esc(shots.final.dataUri)}" alt="${esc(`Final screenshot (${s.strategy})`)}" loading="lazy"><figcaption>Final screenshot</figcaption></figure>`);
    if (shots.fullPage) {
      const fp = shots.fullPage;
      const size = fp.width && fp.height ? ` width="${Math.round(fp.width)}" height="${Math.round(fp.height)}"` : '';
      figs.push(`<figure><div class="fullpage"><img src="${esc(fp.dataUri)}"${size} alt="${esc(`Full-page screenshot (${s.strategy})`)}" loading="lazy"></div><figcaption>Full page${fp.width && fp.height ? ` (${Math.round(fp.width)} × ${Math.round(fp.height)})` : ''}, scroll inside</figcaption></figure>`);
    }
    parts.push(`<h4>Screenshots</h4><div class="shots">${figs.join('')}</div>`);
  } else if (!shots) {
    parts.push('<p class="muted">Screenshots were not included in this report.</p>');
  }
  if (s.insights?.length) {
    const report = psiReportUrl(finalUrl, s.strategy);
    parts.push(`<h4>Insights and diagnostics (${s.insights.length})</h4>${s.insights.map((i) => insightBlock(i, report)).join('')}<p class="muted">The <a href="${safeHref(report)}">full PageSpeed Insights trace</a> has the timeline.</p>`);
  }
  return parts.join('\n');
}

/** The speed section: one panel per strategy, as CSS-only tabs (radio buttons and labels, no script) when there are two. */
function speedSection(speed: SpeedResult[], finalUrl: string): string {
  const head = `<section id="speed"><h2>Speed</h2><p class="speed-note">Lab data from Google's PageSpeed Insights (Lighthouse). ${esc(scoreNote('above'))}</p>`;
  if (speed.length === 1) {
    const s = speed[0]!;
    return `${head}<h3>${s.strategy === 'mobile' ? 'Mobile' : 'Desktop'}</h3><div class="tab-panel only">${speedPanel(s, finalUrl)}</div></section>`;
  }
  const strategies = speed.map((s) => s.strategy);
  const inputs = strategies.map((st, n) => `<input type="radio" class="tab-input" name="speed-tab" id="speed-tab-${st}"${n === 0 ? ' checked' : ''}>`).join('');
  const labels = `<div class="tab-labels">${strategies.map((st) => `<label for="speed-tab-${st}">${st === 'mobile' ? 'Mobile' : 'Desktop'}</label>`).join('')}</div>`;
  const panels = speed.map((s) => `<div class="tab-panel panel-${s.strategy}"><h3 class="tab-title">${s.strategy === 'mobile' ? 'Mobile' : 'Desktop'}</h3>${speedPanel(s, finalUrl)}</div>`).join('');
  return `${head}${inputs}${labels}${panels}</section>`;
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
  if (report.data.speed?.length) parts.push(scoreStrip(report.data.speed));
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

  const speed = report.data.speed;
  if (speed?.length) parts.push(speedSection(speed, report.finalUrl));

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
  parts.push(`<footer><p>${esc(footerLine(report))}</p><p>Generated by <a href="${safeHref(report.tool.url)}">${esc(report.tool.name)}</a> ${esc(report.tool.version)}.</p></footer>`);

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
