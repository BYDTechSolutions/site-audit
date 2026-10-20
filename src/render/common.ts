import { AREA_NAMES, PRIORITIES, type CrawlerRow, type Finding, type Priority, type Report } from '../types.js';

/** Findings bucketed by priority, in priority order. */
export function byPriority(report: Report): { priority: Priority; findings: Finding[] }[] {
  return PRIORITIES.map((priority) => ({ priority, findings: report.findings.filter((f) => f.priority === priority) }));
}

/** Counts per priority. */
export function counts(report: Report): Record<Priority, number> {
  const out = { 'fix-now': 0, 'should-fix': 0, 'nice-to-have': 0 } as Record<Priority, number>;
  for (const f of report.findings) out[f.priority]++;
  return out;
}

/** `12.3 s` or `850 ms`. */
export function duration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
}

/** The robots.txt column of the crawler table. */
export function robotsCell(row: CrawlerRow): string {
  if (row.robotsAllowed === null) return 'unknown';
  const verdict = row.robotsAllowed ? 'allowed' : 'blocked';
  return row.robotsGroup === 'none' ? verdict : `${verdict} (${row.robotsGroup === '*' ? '*' : 'own group'})`;
}

/** The probe column of the crawler table. */
export function probeCell(row: CrawlerRow): string {
  if (!row.probe) return row.purpose === 'training' || row.purpose === 'ads' ? 'robots.txt token only' : '—';
  const marker = row.probe.userAgentKind === 'token-only' ? '*' : '';
  const word = { same: 'ok', blocked: 'BLOCKED', challenged: 'CHALLENGED', different: 'different', error: 'error' }[row.probe.verdict];
  return `${row.probe.status ?? '—'} ${word}${marker}`;
}

/** Areas in the report that have notes, with their human names. */
export function areaName(area: string): string {
  return area === 'general' ? 'General' : AREA_NAMES[area as keyof typeof AREA_NAMES] ?? area;
}

/** The closing line every format prints: why there is no score. */
export const NO_SCORE = 'No overall score, on purpose: a single number hides which problems matter. Work down the list in order.';
