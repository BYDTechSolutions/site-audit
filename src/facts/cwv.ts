/*
 * Core Web Vitals thresholds at the 75th percentile, from Google's PageSpeed
 * Insights documentation (checked on FACTS_VERIFIED_ON). PSI returns its own
 * category per metric; these are quoted in the report so a reader can see
 * where the lines are.
 */

/** Good / poor boundaries for one metric. Good is `<= good`; poor is `> poor`. */
export interface Threshold {
  metric: string;
  good: number;
  poor: number;
  unit: 'ms' | 'score';
}

/** The three Core Web Vitals. */
export const CORE_WEB_VITALS: readonly Threshold[] = [
  { metric: 'Largest Contentful Paint (LCP)', good: 2500, poor: 4000, unit: 'ms' },
  { metric: 'Interaction to Next Paint (INP)', good: 200, poor: 500, unit: 'ms' },
  { metric: 'Cumulative Layout Shift (CLS)', good: 0.1, poor: 0.25, unit: 'score' },
];

/** One line per metric, e.g. "LCP good at or under 2.5 s, poor over 4 s". */
export function describeThresholds(): string {
  return CORE_WEB_VITALS.map((t) => {
    const fmt = (v: number) => (t.unit === 'ms' ? (v >= 1000 ? `${v / 1000} s` : `${v} ms`) : String(v));
    return `${t.metric}: good at or under ${fmt(t.good)}, poor over ${fmt(t.poor)}`;
  }).join('; ');
}
