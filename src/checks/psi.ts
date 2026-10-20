/*
 * Speed and accessibility from the PageSpeed Insights v5 API: Lighthouse lab
 * metrics, failing insights, failing accessibility audits, and Chrome UX
 * Report field data when Google has enough real-user traffic for the page.
 */
import { capList, clip, type AuditContext } from '../context.js';
import { describeThresholds } from '../facts/cwv.js';
import { SOURCES } from '../facts/sources.js';
import { decodeText, safeFetch } from '../net/fetcher.js';
import { classifyHostname } from '../net/ip.js';
import type { FieldMetric, LabMetric, Source, SpeedResult } from '../types.js';

/** The endpoint from Google's "Get started" page. */
export const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

type Json = any;

/** Builds the request URL. Categories are PSI enum values (`PERFORMANCE`, `ACCESSIBILITY`). */
export function psiRequestUrl(target: string, strategy: 'mobile' | 'desktop', categories: string[], key?: string): string {
  const params = new URLSearchParams({ url: target, strategy: strategy.toUpperCase() });
  for (const c of categories) params.append('category', c);
  if (key) params.set('key', key);
  return `${PSI_ENDPOINT}?${params}`;
}

/** First Markdown link URL in a Lighthouse description, as the source of a finding. */
function linkIn(description: string | undefined, fallback: Source): Source {
  const m = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/.exec(description ?? '');
  return m ? { title: m[1] as string, url: m[2] as string } : fallback;
}

/** Strips Markdown links to their text. */
function plain(description: string | undefined): string {
  return (description ?? '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
}

/** `LARGEST_CONTENTFUL_PAINT_MS` → `Largest contentful paint`. */
export function fieldMetricName(key: string): string {
  let k = key;
  const experimental = k.startsWith('EXPERIMENTAL_');
  if (experimental) k = k.slice('EXPERIMENTAL_'.length);
  k = k.replace(/_(MS|SCORE)$/, '');
  const words = k.toLowerCase().split('_').join(' ');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}${experimental ? ' (experimental)' : ''}`;
}

function formatPercentile(key: string, value: number): string {
  return key.endsWith('_MS') ? (value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${value} ms`) : String(value);
}

type PsiOutcome = { ok: true; json: Json } | { ok: false; message: string; quota: boolean };

async function callPsi(ctx: AuditContext, strategy: 'mobile' | 'desktop', categories: string[]): Promise<PsiOutcome> {
  const key = ctx.options.psiKey;
  const redact = (text: string) => (key ? text.split(key).join('<key>') : text);
  try {
    const res = await safeFetch(ctx.net, psiRequestUrl(ctx.page.url, strategy, categories, key), {
      accept: 'application/json',
      timeoutMs: ctx.options.psiTimeoutMs,
      maxBytes: 40_000_000,
    });
    const text = decodeText(res.body, 'charset=utf-8');
    let json: Json;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, message: `PageSpeed Insights answered ${res.status} with a body that is not JSON.`, quota: false };
    }
    if (res.status !== 200 || json?.error) {
      const message = redact(String(json?.error?.message ?? `HTTP ${res.status}`));
      const quota = res.status === 429 || json?.error?.status === 'RESOURCE_EXHAUSTED' || /quota/i.test(message);
      return { ok: false, message, quota };
    }
    return { ok: true, json };
  } catch (error) {
    return { ok: false, message: redact((error as Error).message), quota: false };
  }
}

/** Runs PSI for each strategy and maps the results into speed and accessibility findings. */
export async function checkPsi(ctx: AuditContext, areas: { speed: boolean; accessibility: boolean }): Promise<void> {
  const label = [areas.speed && 'speed', areas.accessibility && 'accessibility'].filter(Boolean).join(' and ');
  // One note for the run, filed under the first area asked for.
  const noteBoth = (message: string) => ctx.note(areas.speed ? 'speed' : 'accessibility', message);
  if (!ctx.options.psi) {
    noteBoth(`PageSpeed Insights was skipped (--no-psi), so ${label} were not measured.`);
    return;
  }
  if (classifyHostname(ctx.pageUrl.hostname.replace(/^\[|\]$/g, ''))) {
    noteBoth(`PageSpeed Insights runs on Google's servers and cannot reach ${ctx.pageUrl.host}, so ${label} were not measured. Run Lighthouse locally, or audit the deployed URL.`);
    return;
  }
  const categories = [areas.speed && 'PERFORMANCE', areas.accessibility && 'ACCESSIBILITY'].filter(Boolean) as string[];
  const results: SpeedResult[] = [];
  let a11yDone = false;

  for (const strategy of ctx.options.strategies) {
    ctx.progress(`Running PageSpeed Insights (${strategy}); this usually takes 20-60 seconds`);
    const outcome = await callPsi(ctx, strategy, categories);
    if (!outcome.ok) {
      results.push({ strategy, error: outcome.message, lighthouseVersion: null, metrics: [], field: null });
      noteBoth(outcome.quota
        ? `PageSpeed Insights quota exceeded (${strategy}): "${clip(outcome.message, 160)}". ${ctx.options.psiKey ? 'The key\'s daily quota is used up; try again later.' : 'Without an API key, requests share Google\'s quota; pass --psi-key or set PSI_API_KEY (Google recommends a key for automated queries).'} The rest of the report is unaffected.`
        : `PageSpeed Insights failed (${strategy}): ${clip(outcome.message, 200)}. The rest of the report is unaffected.`);
      continue;
    }
    const json = outcome.json;
    const lhr = json.lighthouseResult ?? {};
    if (lhr.runtimeError?.code && lhr.runtimeError.code !== 'NO_ERROR') {
      noteBoth(`Lighthouse reported an error (${strategy}): ${lhr.runtimeError.code} ${clip(String(lhr.runtimeError.message ?? ''), 160)}. Its numbers may be unreliable.`);
    }
    const audits: Record<string, Json> = lhr.audits ?? {};
    const result: SpeedResult = { strategy, error: null, lighthouseVersion: lhr.lighthouseVersion ?? null, metrics: [], field: null };

    if (areas.speed) {
      const perf = lhr.categories?.performance;
      const refs: Json[] = perf?.auditRefs ?? [];
      for (const ref of refs.filter((r) => r.group === 'metrics')) {
        const a = audits[ref.id];
        if (!a) continue;
        const metric: LabMetric = { id: a.id ?? ref.id, title: a.title ?? ref.id, displayValue: a.displayValue ?? '', numericValue: a.numericValue ?? null, score: a.score ?? null };
        result.metrics.push(metric);
        if (metric.score === null || metric.score >= 0.9) continue;
        ctx.add({
          id: `speed/metric-${metric.id}`, area: 'speed', priority: metric.score < 0.5 ? 'should-fix' : 'nice-to-have', label: 'measured',
          title: `${metric.title}: ${metric.displayValue} (lab, ${strategy})`,
          observed: `Lighthouse rates this ${metric.score < 0.5 ? 'poor' : 'needs improvement'} (metric score ${Math.round(metric.score * 100)}/100) in one simulated ${strategy} load.`,
          why: plain(a.description),
          fix: 'See the insights listed for this strategy; they say what delays it and the estimated savings.',
          source: linkIn(a.description, SOURCES.webVitals),
        });
      }
      for (const ref of refs.filter((r) => r.group === 'insights' || r.group === 'diagnostics')) {
        const a = audits[ref.id];
        if (!a || a.score === null || a.score === undefined || a.score >= 0.5) continue;
        if (!['metricSavings', 'numeric', 'binary'].includes(a.scoreDisplayMode)) continue;
        const savings: Record<string, number> = a.metricSavings ?? {};
        const big = (savings.LCP ?? 0) >= 500 || (savings.FCP ?? 0) >= 500 || (savings.CLS ?? 0) >= 0.1 || (savings.TBT ?? 0) >= 200;
        ctx.add({
          id: `speed/${ref.id}`, area: 'speed', priority: big ? 'should-fix' : 'nice-to-have', label: 'measured',
          title: `${a.title}${a.displayValue ? ` — ${a.displayValue}` : ''} (${strategy})`,
          observed: Object.keys(savings).length
            ? `Estimated savings: ${Object.entries(savings).filter(([, v]) => v).map(([k, v]) => `${k} ${k === 'CLS' ? v : `${Math.round(v)} ms`}`).join(', ') || 'none quantified'}.`
            : 'Lighthouse flags this as failing.',
          why: plain(a.description),
          fix: 'Follow the linked guide; the Lighthouse report in PageSpeed Insights lists the exact resources.',
          source: linkIn(a.description, SOURCES.lighthouseInsights),
        });
      }

      const page = json.loadingExperience;
      const origin = json.originLoadingExperience;
      const pageHas = page?.metrics && Object.keys(page.metrics).length > 0;
      const originHas = origin?.metrics && Object.keys(origin.metrics).length > 0;
      const chosen = pageHas ? page : originHas ? origin : null;
      if (chosen) {
        const scope: 'page' | 'origin' = pageHas && !page.origin_fallback ? 'page' : 'origin';
        const metrics: FieldMetric[] = Object.entries(chosen.metrics as Record<string, Json>).map(([key, m]) => ({
          key,
          name: fieldMetricName(key),
          percentile: Number(m.percentile),
          category: String(m.category ?? 'NONE'),
        }));
        result.field = { scope, overallCategory: chosen.overall_category ?? null, metrics };
        for (const m of metrics) {
          if (m.category !== 'SLOW' && m.category !== 'AVERAGE') continue;
          ctx.add({
            id: `speed/field-${m.key.toLowerCase()}`, area: 'speed', priority: m.category === 'SLOW' ? 'should-fix' : 'nice-to-have', label: 'google-documented',
            title: `Real users (${scope === 'page' ? 'this page' : 'whole site'}, ${strategy}): ${m.name} is ${m.category === 'SLOW' ? 'poor' : 'needs improvement'}`,
            observed: `75th percentile ${formatPercentile(m.key, m.percentile)}; Google's category: ${m.category}. From the Chrome UX Report (real Chrome visits).`,
            why: `Google judges Core Web Vitals at the 75th percentile of real visits. ${describeThresholds()}.`,
            fix: 'Work through the lab insights for this strategy; field data changes only as real visitors get the faster page.',
            source: SOURCES.psiAbout,
          });
        }
      } else {
        ctx.note('speed', `Field data (${strategy}): not enough real-user traffic for field data. Google's Chrome UX Report has no data for this page or site, so only lab numbers are shown.`);
      }
      ctx.note('speed', `Lab numbers come from one simulated ${strategy} load on Google's servers and vary from run to run.`);
    }

    if (areas.accessibility && !a11yDone) {
      a11yDone = true;
      const cat = lhr.categories?.accessibility;
      const refs: Json[] = (cat?.auditRefs ?? []).filter((r: Json) => r.group !== 'hidden');
      const failing = refs
        .map((r) => ({ ref: r, a: audits[r.id] }))
        .filter(({ a }) => a && a.scoreDisplayMode === 'binary' && a.score === 0);
      for (const { ref, a } of failing) {
        const nodes: string[] = (a.details?.items ?? [])
          .map((item: Json) => item.node)
          .filter(Boolean)
          .map((node: Json) => `${node.selector ?? node.nodeLabel ?? ''}${node.snippet ? ` — ${clip(String(node.snippet), 100)}` : ''}`);
        ctx.add({
          id: `accessibility/${ref.id}`, area: 'accessibility', priority: (ref.weight ?? 0) >= 7 ? 'should-fix' : 'nice-to-have', label: 'measured',
          title: a.title,
          observed: nodes.length ? `${nodes.length} failing element(s).` : 'Lighthouse reports this audit as failing.',
          why: plain(a.description),
          fix: 'Fix each element listed; the linked rule explains what passes.',
          source: linkIn(a.description, SOURCES.lighthouseA11y),
          details: nodes.length ? capList(nodes, 5) : undefined,
        });
      }
      if (!failing.length && cat) ctx.pass('accessibility/automated', 'accessibility', 'Lighthouse found no failing automated accessibility audits');
      ctx.note('accessibility', 'Automated checks catch only part of accessibility problems (Lighthouse says so itself); a manual review is still needed. Guide: https://web.dev/articles/how-to-review');
    }
    results.push(result);
  }
  if (areas.speed) ctx.data.speed = results;
}
