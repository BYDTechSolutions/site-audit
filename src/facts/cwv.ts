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

/** Google's three bands: Core Web Vitals use good / needs improvement / poor, and so does Lighthouse's color scale. */
export type Rating = 'good' | 'needs-improvement' | 'poor';

/** Lighthouse lab metric audit id → its Core Web Vital, where it has one. */
const LAB_CWV: Record<string, string> = {
  'largest-contentful-paint': 'Largest Contentful Paint (LCP)',
  'cumulative-layout-shift': 'Cumulative Layout Shift (CLS)',
  'interaction-to-next-paint': 'Interaction to Next Paint (INP)',
};

/** Rates a value against a Core Web Vital: good at or under `good`, poor over `poor`. */
export function rateCwv(t: Threshold, value: number): Rating {
  return value <= t.good ? 'good' : value > t.poor ? 'poor' : 'needs-improvement';
}

/**
 * Rates a Lighthouse 0–1 score (a metric's or a category's) on Lighthouse's
 * color scale: 90–100 good, 50–89 needs improvement, 0–49 poor.
 * Source (checked 2026-10-23): https://developer.chrome.com/docs/lighthouse/performance/performance-scoring
 * and Lighthouse's report renderer (pass at 0.9, average at 0.5).
 */
export function rateLighthouseScore(score: number): Rating {
  return score >= 0.9 ? 'good' : score >= 0.5 ? 'needs-improvement' : 'poor';
}

/** The Core Web Vitals threshold for a Lighthouse lab metric id, if the metric is one. */
export function labThreshold(id: string): Threshold | undefined {
  return CORE_WEB_VITALS.find((x) => x.metric === LAB_CWV[id]);
}

/**
 * Rates one lab metric: by Google's Core Web Vitals threshold when the metric
 * is one (LCP, CLS, INP; `numericValue` in ms, or unitless for CLS), otherwise
 * by the metric score Lighthouse gave it. `null` when there is neither.
 */

export function rateLabMetric(id: string, numericValue: number | null, score: number | null): { rating: Rating; basis: 'core-web-vitals' | 'lighthouse' } | null {
  const t = labThreshold(id);
  if (t && typeof numericValue === 'number' && Number.isFinite(numericValue)) return { rating: rateCwv(t, numericValue), basis: 'core-web-vitals' };
  if (typeof score === 'number') return { rating: rateLighthouseScore(score), basis: 'lighthouse' };
  return null;
}
