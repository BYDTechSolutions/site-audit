import { AREA_NAMES, PRIORITIES, type CrawlerRow, type Finding, type InsightColumn, type Priority, type Report, type SpeedResult } from '../types.js';

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

/** The closing line when the report has no Google scores: we add no score of our own. */
export const NO_SCORE = 'No overall score of our own: a single number hides which problems matter. Work down the fix list in order.';

/** The closing line when the report shows Google's Lighthouse scores. */
export const SCORES_FOOTER = "Scores are Google's Lighthouse lab scores for one simulated load; the fix list is what to do about them. We add no overall score of our own.";

/** Whether any strategy carries Google's scores. */
export function hasScores(report: Report): boolean {
  return (report.data.speed ?? []).some((s) => s.scores && Object.keys(s.scores).length > 0);
}

/** The closing line for this report. */
export function footerLine(report: Report): string {
  return hasScores(report) ? SCORES_FOOTER : NO_SCORE;
}

/** The one line every format prints in the speed section: whose 0–100 that is. */
export function scoreNote(where: 'above' | 'below'): string {
  return `Scores are Google's Lighthouse lab scores for one simulated load; the fix list ${where} is what to do about them. We add no overall score of our own.`;
}

/** One of Google's category scores, ready to render. `value` is 0–100, or passed/total for a fraction category. */
export interface ScoreItem {
  key: 'performance' | 'accessibility' | 'bestPractices' | 'seo' | 'agenticBrowsing';
  name: string;
  /** 0–100 for a gauge; for a fraction, the share passed × 100 (for the color only). */
  value: number;
  /** `78` or `2/3`. */
  text: string;
  fraction?: { passed: number; total: number };
}

const SCORE_NAMES: [ScoreItem['key'], string][] = [
  ['performance', 'Performance'],
  ['accessibility', 'Accessibility'],
  ['bestPractices', 'Best practices'],
  ['seo', 'SEO'],
  ['agenticBrowsing', 'Agentic browsing'],
];

/** Google's scores for one strategy, in Lighthouse's order. */
export function scoreItems(s: SpeedResult): ScoreItem[] {
  const out: ScoreItem[] = [];
  for (const [key, name] of SCORE_NAMES) {
    const v = s.scores?.[key];
    if (typeof v === 'number') out.push({ key, name, value: v, text: String(v) });
    else if (v && typeof v === 'object' && v.total > 0) out.push({ key, name, value: Math.round((v.passed / v.total) * 100), text: `${v.passed}/${v.total}`, fraction: v });
  }
  return out;
}

/** `Lighthouse performance (Google lab score): 78 / 100 · accessibility: 100 / 100 · ... · agentic browsing: 2/3 audits passed`, or `null`. */
export function scoreLine(s: SpeedResult): string | null {
  const parts = scoreItems(s).map((item, n) => {
    const name = item.key === 'seo' ? 'SEO' : item.name.toLowerCase();
    return `${name}${n ? '' : ' (Google lab score)'}: ${item.fraction ? `${item.text} audits passed` : `${item.text} / 100`}`;
  });
  return parts.length ? `Lighthouse ${parts.join(' · ')}` : null;
}

/** `LCP 900 ms, CLS 0.12`; zero savings are left out. */
export function savingsText(savings: Record<string, number>): string {
  return Object.entries(savings)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k} ${k === 'CLS' ? Math.round(v * 1000) / 1000 : `${Math.round(v)} ms`}`)
    .join(', ');
}

/** One insight-table cell as text: bytes in KiB, times in ms or s, as Lighthouse shows them. */
export function cellText(col: InsightColumn, value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'number') return value;
  switch (col.type) {
    case 'bytes':
      return value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MiB` : `${(value / 1024).toFixed(1)} KiB`;
    case 'ms':
    case 'timespanMs':
      return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;
    default:
      return String(Math.round(value * 1000) / 1000);
  }
}

/** Whether a column holds numbers (right-aligned in tables). */
export function isNumberColumn(col: InsightColumn): boolean {
  return col.type === 'bytes' || col.type === 'ms' || col.type === 'timespanMs' || col.type === 'numeric';
}
