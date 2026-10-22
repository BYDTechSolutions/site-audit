import { AREA_NAMES, LABEL_NAMES, PRIORITY_NAMES, type Report } from '../types.js';
import { areaName, byPriority, cellText, counts, duration, isNumberColumn, footerLine, probeCell, robotsCell, savingsText, scoreNote, scoreLine } from './common.js';

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const inline = (s: string) => s.replace(/([<>])/g, '\\$1');
const htmlText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** A URL safe inside `(...)` of a Markdown link; only http(s). */
const linkUrl = (url: string) => (/^https?:\/\//i.test(url) ? url.replace(/[()\s<>]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`) : null);
const linkText = (s: string) => inline(cell(s)).replace(/([[\]])/g, '\\$1');
/** A Markdown link only for http(s) URLs; anything else is printed as plain text, never as a link. */
const mdLink = (text: string, url: string) => {
  const safe = linkUrl(url);
  return safe ? `[${linkText(text)}](${safe})` : `${linkText(text)} (${inline(cell(url))})`;
};

/** Renders a report as GitHub-flavored Markdown. */
export function formatMarkdown(report: Report): string {
  const c = counts(report);
  const out: string[] = [];
  out.push(`# Site audit: ${report.url}`, '');
  out.push(`${report.areas.length} areas checked on ${report.startedAt.slice(0, 16).replace('T', ' ')} UTC in ${duration(report.durationMs)}. **${c['fix-now']} fix now**, **${c['should-fix']} should fix**, **${c['nice-to-have']} nice to have**, ${report.passed.length} passed.`);
  if (report.finalUrl !== report.url) out.push('', `Ended at ${report.finalUrl} (HTTP ${report.data.page.status}).`);
  out.push('', '> Labels: **Measured** = observed on the site in this run. **Google-documented** = Google\'s own documentation says it matters. **Optional / speculative** = no search engine has confirmed it matters.');

  for (const { priority, findings } of byPriority(report)) {
    if (!findings.length) continue;
    out.push('', `## ${PRIORITY_NAMES[priority]} (${findings.length})`);
    for (const f of findings) {
      out.push('', `### ${inline(f.title)}`, '');
      out.push(`*${LABEL_NAMES[f.label]} · ${AREA_NAMES[f.area]}* · \`${f.id}\``, '');
      out.push(`- **What we saw:** ${inline(f.observed)}`);
      out.push(`- **Why it matters:** ${inline(f.why)}`);
      out.push(`- **How to fix:** ${inline(f.fix)}`);
      out.push(`- **Source:** ${mdLink(f.source.title, f.source.url)}`);
      if (f.details?.length) {
        out.push('', '<details><summary>Details</summary>', '');
        for (const d of f.details) out.push(`- ${inline(d)}`);
        out.push('', '</details>');
      }
    }
  }
  if (!report.findings.length) out.push('', 'Nothing to fix in the areas checked.');

  const crawlers = report.data.crawlers;
  if (crawlers?.length) {
    out.push('', '## AI crawler access', '', '| Crawler | Operator | Purpose | robots.txt | Probe |', '|---|---|---|---|---|');
    for (const r of crawlers) out.push(`| ${mdLink(r.token, r.source.url)} | ${r.operator} | ${r.purpose} | ${cell(robotsCell(r))} | ${cell(probeCell(r))} |`);
    out.push('', 'Probe results are indicative: real bots come from their own IP ranges. `*` = no full user agent is published; the probe sent one containing the token.');
  }

  const preview = report.data.preview;
  if (preview) {
    out.push('', '## Link preview', '');
    out.push(`- **Title:** ${inline(preview.title ?? '(none)')}`);
    out.push(`- **Description:** ${inline(preview.description ?? '(none)')}`);
    out.push(`- **Image:** ${preview.image ? `${preview.image.url}${preview.image.width ? ` (${preview.image.width}×${preview.image.height})` : ''}` : '(none)'}`);
  }

  let scoreNoted = false;
  for (const s of report.data.speed ?? []) {
    out.push('', `## Speed (${s.strategy})`, '');
    if (s.error) {
      out.push(`Not measured: ${inline(s.error)}`);
      continue;
    }
    const scores = scoreLine(s);
    if (scores) {
      out.push(`**${scores}**${s.scoreSource ? ` ([how Google scores it](${s.scoreSource.url}))` : ''}`, '');
      if (!scoreNoted) out.push(`*${scoreNote('above')}*`, '');
      scoreNoted = true;
    }
    out.push('| Lab metric | Value |', '|---|---|');
    for (const m of s.metrics) out.push(`| ${m.title} | ${m.displayValue} |`);
    out.push('');
    if (s.field) {
      out.push(`Real users (${s.field.scope === 'page' ? 'this page' : 'whole site'}, Chrome UX Report):`, '', '| Metric | 75th percentile | Google\'s category |', '|---|---|---|');
      for (const m of s.field.metrics) out.push(`| ${m.name} | ${m.percentile}${m.key.endsWith('_MS') ? ' ms' : ''} | ${m.category} |`);
    } else {
      out.push('Real users: not enough real-user traffic for field data.');
    }
    if (s.insights?.length) {
      out.push('', `### Insights and diagnostics (${s.strategy}, ${s.insights.length})`);
      for (const i of s.insights) {
        out.push('', `<details><summary>${htmlText(i.title)}${i.displayValue ? ` — ${htmlText(i.displayValue)}` : ''}</summary>`, '');
        const savings = savingsText(i.metricSavings);
        out.push(`${inline(i.description)}${savings ? ` Estimated savings: ${savings}.` : ''} Source: [${linkText(i.source.title)}](${linkUrl(i.source.url) ?? '#'})`);
        const t = i.table;
        if (t) {
          out.push('', `| ${t.columns.map((c) => cell(inline(c.label))).join(' | ')} |`, `|${t.columns.map((c) => (isNumberColumn(c) ? '---:' : '---')).join('|')}|`);
          t.rows.forEach((row, n) => {
            out.push(`| ${t.columns.map((c) => {
              const text = cellText(c, row[c.key]);
              const href = t.fullUrls[n]?.[c.key];
              const url = href ? linkUrl(href) : null;
              return url && text ? `[${linkText(text)}](${url})` : cell(inline(text));
            }).join(' | ')} |`);
          });
          if (t.moreRows) out.push('', `${t.moreRows} more row(s) in the full PageSpeed Insights trace.`);
        }
        out.push('', '</details>');
      }
    }
  }

  const tags = report.data.tags;
  if (tags) {
    out.push('', `## Installed tags (${tags.length})`, '');
    if (!tags.length) out.push('None of the known tags appear in the HTML.');
    for (const t of tags) out.push(`- **${t.name}** (${t.category})${t.ids.length ? `: ${t.ids.join(', ')}` : ''}`);
  }
  const links = report.data.links;
  if (links) out.push('', '## Links', '', `${links.found} found, ${links.checked} checked, ${links.ok} ok, ${links.broken} broken, ${links.unverified} unverified, ${links.skipped} skipped.`);

  if (report.passed.length) {
    out.push('', `## Passed (${report.passed.length})`, '');
    for (const p of report.passed) out.push(`- ${inline(p.title)} (${AREA_NAMES[p.area]})`);
  }
  if (report.notes.length) {
    out.push('', '## Notes', '');
    for (const n of report.notes) out.push(`- **${areaName(n.area)}:** ${inline(n.message)}`);
  }
  out.push('', '---', '', `${footerLine(report)} Generated by [${report.tool.name}](${report.tool.url}) ${report.tool.version}.`);
  return out.join('\n') + '\n';
}
