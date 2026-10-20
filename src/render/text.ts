import { AREA_NAMES, LABEL_NAMES, PRIORITY_NAMES, type Priority, type Report } from '../types.js';
import { areaName, byPriority, counts, duration, NO_SCORE, probeCell, robotsCell } from './common.js';

/** Options for {@link formatText}. */
export interface TextOptions {
  /** ANSI colors. Default `false`. */
  color?: boolean;
  /** Wrap width. Default `100`. */
  width?: number;
}

function wrap(text: string, width: number, indent: string, firstIndent = indent): string {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let line = firstIndent;
  let lineHasWord = false;
  for (const word of words) {
    if (lineHasWord && line.length + 1 + word.length > width) {
      lines.push(line);
      line = indent + word;
    } else {
      line += (lineHasWord ? ' ' : '') + word;
    }
    lineHasWord = true;
  }
  lines.push(line);
  return lines.join('\n');
}

function pad(text: string, n: number): string {
  return text.length >= n ? text : text + ' '.repeat(n - text.length);
}

/** Renders a report for a terminal: grouped by priority, then the data tables. */
export function formatText(report: Report, options: TextOptions = {}): string {
  const width = Math.max(60, options.width ?? 100);
  const on = options.color ?? false;
  const esc = (code: string) => (s: string) => (on ? `\u001b[${code}m${s}\u001b[0m` : s);
  const bold = esc('1');
  const dim = esc('2');
  const green = esc('32');
  const colorOf: Record<Priority, (s: string) => string> = { 'fix-now': esc('1;31'), 'should-fix': esc('1;33'), 'nice-to-have': esc('1;36') };
  const out: string[] = [];
  const c = counts(report);

  out.push(bold(`Site audit: ${report.url}`));
  if (report.finalUrl !== report.url) out.push(dim(`Ended at ${report.finalUrl} (HTTP ${report.data.page.status})`));
  out.push(dim(`${report.areas.length} areas checked in ${duration(report.durationMs)}`) + `  ${colorOf['fix-now'](`${c['fix-now']} fix now`)} · ${colorOf['should-fix'](`${c['should-fix']} should fix`)} · ${colorOf['nice-to-have'](`${c['nice-to-have']} nice to have`)} · ${green(`${report.passed.length} passed`)}`);

  let n = 0;
  for (const { priority, findings } of byPriority(report)) {
    if (!findings.length) continue;
    out.push('', colorOf[priority](`${PRIORITY_NAMES[priority].toUpperCase()} (${findings.length})`));
    for (const f of findings) {
      n++;
      out.push('');
      out.push(wrap(`${bold(`${n}. ${f.title}`)}`, width + (on ? 8 : 0), '   ', '  '));
      out.push(dim(`   [${LABEL_NAMES[f.label]}] ${AREA_NAMES[f.area]}`));
      out.push(wrap(`Saw: ${f.observed}`, width, '        ', '   '));
      out.push(wrap(`Why: ${f.why}`, width, '        ', '   '));
      out.push(wrap(`Fix: ${f.fix}`, width, '        ', '   '));
      for (const d of f.details ?? []) out.push(wrap(`- ${d}`, width, '       ', '     '));
      out.push(dim(`   Source: ${f.source.title} <${f.source.url}>`));
    }
  }
  if (!report.findings.length) out.push('', green('Nothing to fix in the areas checked.'));

  const crawlers = report.data.crawlers;
  if (crawlers?.length) {
    out.push('', bold('AI CRAWLER ACCESS') + dim('  (robots.txt verdict for this URL, and one request per user agent)'));
    out.push(dim(`  ${pad('Crawler', 21)}${pad('Operator', 13)}${pad('Purpose', 11)}${pad('robots.txt', 22)}Probe`));
    for (const r of crawlers) {
      const probe = probeCell(r);
      const flagged = /BLOCKED|CHALLENGED/.test(probe) || r.robotsAllowed === false;
      const line = `  ${pad(r.token, 21)}${pad(r.operator, 13)}${pad(r.purpose, 11)}${pad(robotsCell(r), 22)}${probe}`;
      out.push(flagged && (r.purpose === 'search' || r.purpose === 'user-fetch' || r.purpose === 'preview') ? colorOf['should-fix'](line) : line);
    }
    if (crawlers.some((r) => r.probe?.userAgentKind === 'token-only')) out.push(dim('  * no full user agent is published for this bot; the probe sent one containing its token.'));
    out.push(dim('  Probe results are indicative: real bots come from their own IP ranges.'));
  }

  const preview = report.data.preview;
  if (preview) {
    out.push('', bold('LINK PREVIEW') + dim('  (from Open Graph and meta tags)'));
    out.push(wrap(`Title: ${preview.title ?? '(none)'}`, width, '         ', '  '));
    out.push(wrap(`Text:  ${preview.description ?? '(none)'}`, width, '         ', '  '));
    const img = preview.image;
    out.push(wrap(`Image: ${img ? `${img.url}${img.width ? ` (${img.width}×${img.height})` : ''}${img.status && img.status !== 200 ? ` — HTTP ${img.status}` : ''}` : '(none)'}`, width, '         ', '  '));
  }

  for (const s of report.data.speed ?? []) {
    out.push('', bold(`SPEED (PageSpeed Insights, ${s.strategy}${s.lighthouseVersion ? `, Lighthouse ${s.lighthouseVersion}` : ''})`));
    if (s.error) {
      out.push(wrap(`Not measured: ${s.error}`, width, '    ', '  '));
      continue;
    }
    out.push(`  Lab: ${s.metrics.map((m) => `${m.title} ${m.displayValue}`).join(' · ')}`);
    if (s.field) {
      out.push(`  Real users (${s.field.scope === 'page' ? 'this page' : 'whole site'}): ${s.field.metrics.map((m) => `${m.name} ${m.key.endsWith('_MS') ? `${m.percentile} ms` : m.percentile} (${m.category})`).join(' · ')}`);
    } else {
      out.push('  Real users: not enough real-user traffic for field data.');
    }
  }

  const tags = report.data.tags;
  if (tags) {
    out.push('', bold(`INSTALLED TAGS (${tags.length})`));
    if (!tags.length) out.push('  None of the known tags appear in the HTML.');
    const groups = new Map<string, string[]>();
    for (const t of tags) groups.set(t.category, [...(groups.get(t.category) ?? []), `${t.name}${t.ids.length ? ` (${t.ids.join(', ')})` : ''}`]);
    for (const [cat, names] of groups) out.push(wrap(`${cat}: ${names.join(', ')}`, width, '    ', '  '));
  }

  const links = report.data.links;
  if (links) {
    out.push('', bold('LINKS') + `  ${links.found} found · ${links.checked} checked · ${links.ok} ok · ${links.broken} broken · ${links.unverified} unverified · ${links.skipped} skipped`);
  }
  const sm = report.data.sitemaps;
  if (sm) {
    out.push('', bold('ROBOTS & SITEMAPS') + `  robots.txt: ${sm.robotsTxt?.status ?? 'unreachable'} · sitemaps read: ${sm.sitemaps.filter((x) => x.kind !== 'unreachable').length} of ${sm.sitemaps.length} · URLs listed: ${sm.totalUrls}`);
  }

  if (report.passed.length) {
    out.push('', green(`PASSED (${report.passed.length})`));
    for (const p of report.passed) out.push(wrap(`${green('✓')} ${p.title} ${dim(`(${AREA_NAMES[p.area]})`)}`, width + (on ? 18 : 0), '    ', '  '));
  }
  if (report.notes.length) {
    out.push('', bold('NOTES'));
    for (const note of report.notes) out.push(wrap(`- [${areaName(note.area)}] ${note.message}`, width, '    ', '  '));
  }
  out.push('', dim(NO_SCORE));
  out.push(dim(`${report.tool.name} ${report.tool.version} · ${report.tool.url}`));
  return out.join('\n') + '\n';
}
