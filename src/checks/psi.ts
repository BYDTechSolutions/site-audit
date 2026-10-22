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
import type { FieldMetric, InsightColumn, InsightDetail, InsightRow, InsightTable, LabMetric, Source, SpeedImage, SpeedResult, SpeedScores, SpeedScreenshots } from '../types.js';

/** The endpoint from Google's "Get started" page. */
export const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

type Json = any;

/**
 * The categories requested when speed is audited: every one the PSI v5
 * `category` enum lists as current (PWA is deprecated there), so the report
 * can show Google's full score row. AGENTIC_BROWSING is the newest.
 */
export const SPEED_CATEGORIES = ['PERFORMANCE', 'ACCESSIBILITY', 'BEST_PRACTICES', 'SEO', 'AGENTIC_BROWSING'] as const;

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

/**
 * Strips Markdown links to their text, and drops the "Learn more…" sentences
 * Lighthouse ends its descriptions with: the link they pointed to is already
 * the finding's source, and as plain text they read as a dangling invitation.
 */
export function plain(description: string | undefined): string {
  const text = (description ?? '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
  const sentences = text.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [text];
  return sentences
    .filter((s) => !/^\s*learn\s+(more|why|how)\b/i.test(s))
    .join('')
    .trim();
}

/** Lighthouse metric audit id → the key its insights report savings under. */
const METRIC_SAVINGS_KEY: Record<string, string> = {
  'first-contentful-paint': 'FCP',
  'largest-contentful-paint': 'LCP',
  'total-blocking-time': 'TBT',
  'cumulative-layout-shift': 'CLS',
};

/** The resources a failing insight names (render-blocking files, images…), deduplicated. */
function insightResources(audit: Json): string[] {
  const items: Json[] = audit?.details?.items ?? [];
  const urls = items
    .map((item) => item?.url ?? item?.source?.url ?? item?.node?.snippet)
    .filter((u): u is string => typeof u === 'string' && u.length > 0)
    .map((u) => clip(u, 140));
  return [...new Set(urls)];
}

/** Most rows kept per insight table; the rest are counted in `moreRows`. */
export const INSIGHT_ROW_CAP = 15;

/**
 * A URL for a table cell: the path for the audited page's own origin, host and
 * path otherwise, cut in the middle past `max` characters.
 */
export function shortUrl(url: string, pageOrigin: string, max = 72): string {
  let s = url;
  if (url.startsWith('data:')) return clip(url, 32);
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:') s = u.origin === pageOrigin ? `${u.pathname}${u.search}` || '/' : `${u.host}${u.pathname === '/' && !u.search ? '' : u.pathname}${u.search}`;
  } catch {
    // not a URL: keep it as written
  }
  s = s.replace(/\s+/g, ' ');
  if (s.length <= max) return s;
  const head = Math.ceil(max * 0.6);
  return `${s.slice(0, head)}…${s.slice(s.length - (max - head - 1))}`;
}

const URL_TYPES = new Set(['url', 'source-location', 'link']);
const SKIP_TYPES = new Set(['thumbnail', 'debugdata']);

/** One table cell as plain text or a number, plus the full URL behind a shortened one. */
function cellOf(value: Json, type: string, origin: string): { v: string | number | null; full?: string } {
  if (value === null || value === undefined) return { v: null };
  const asUrl = (url: string, suffix = '') => {
    const full = /^https?:\/\//i.test(url) ? url.slice(0, 2048) : undefined;
    return { v: `${shortUrl(url, origin)}${suffix}`, full };
  };
  if (typeof value === 'number') return { v: Number.isFinite(value) ? value : null };
  if (typeof value === 'boolean') return { v: value ? 'yes' : 'no' };
  if (typeof value === 'string') return URL_TYPES.has(type) ? asUrl(value) : { v: clip(value, 200) };
  if (typeof value !== 'object') return { v: null };
  switch (value.type) {
    case 'node': {
      const name = String(value.selector ?? value.nodeLabel ?? '');
      const text = `${clip(name, 120)}${value.snippet ? `${name ? ' — ' : ''}${clip(String(value.snippet), 100)}` : ''}`;
      return { v: text || null };
    }
    case 'source-location':
      return typeof value.url === 'string' ? asUrl(value.url, typeof value.line === 'number' ? `:${value.line + 1}` : '') : { v: null };
    case 'url':
      return typeof value.value === 'string' ? asUrl(value.value) : { v: null };
    case 'link': {
      const text = clip(String(value.text ?? value.url ?? ''), 120);
      return { v: text || null, full: typeof value.url === 'string' && /^https?:\/\//i.test(value.url) ? value.url.slice(0, 2048) : undefined };
    }
    case 'numeric':
      return { v: typeof value.value === 'number' && Number.isFinite(value.value) ? value.value : null };
    case 'code':
    case 'text':
      return { v: value.value === undefined || value.value === null ? null : clip(String(value.value), 200) };
    case 'baseline-status':
      return { v: value.displayString ? clip(String(value.displayString), 80) : null };
    default:
      return { v: null };
  }
}

/**
 * Normalizes a Lighthouse `details` object into a plain table: `table` and
 * `opportunity` as they are, the first table inside a `list` (Lighthouse 13's
 * LCP breakdown, for one), and a `checklist` as check / passed rows. Other
 * shapes (network trees, filmstrips) have no table.
 */
export function insightTable(details: Json, pageOrigin: string, cap = INSIGHT_ROW_CAP): InsightTable | undefined {
  if (!details || typeof details !== 'object') return undefined;
  let table: Json = null;
  if (details.type === 'table' || details.type === 'opportunity') table = details;
  else if (details.type === 'list' && Array.isArray(details.items)) {
    for (const item of details.items) {
      if (item?.type === 'table') { table = item; break; }
      if (item?.type === 'list-section' && item.value?.type === 'table') { table = item.value; break; }
    }
  } else if (details.type === 'checklist' && details.items && typeof details.items === 'object') {
    const entries = Object.values(details.items as Record<string, Json>);
    table = {
      headings: [{ key: 'label', label: 'Check', valueType: 'text' }, { key: 'value', label: 'Passed', valueType: 'text' }],
      items: entries.map((e) => ({ label: e?.label, value: e?.value })),
    };
  }
  if (!table || !Array.isArray(table.headings) || !Array.isArray(table.items) || !table.items.length) return undefined;
  const columns: InsightColumn[] = (table.headings as Json[])
    .filter((h) => typeof h?.key === 'string' && h.key && !SKIP_TYPES.has(h.valueType))
    .map((h) => ({
      key: h.key as string,
      label: typeof h.label === 'string' && h.label ? h.label : h.valueType === 'node' ? 'Element' : h.key,
      type: typeof h.valueType === 'string' ? h.valueType : 'text',
    }));
  if (!columns.length) return undefined;
  const items: Json[] = table.items;
  const rows: InsightRow[] = [];
  const fullUrls: Record<string, string>[] = [];
  for (const item of items.slice(0, Math.max(0, cap))) {
    const row: InsightRow = {};
    const full: Record<string, string> = {};
    for (const col of columns) {
      const c = cellOf(item?.[col.key], col.type, pageOrigin);
      row[col.key] = c.v;
      if (c.full) full[col.key] = c.full;
    }
    rows.push(row);
    fullUrls.push(full);
  }
  return { columns, rows, fullUrls, moreRows: items.length - rows.length };
}

const DATA_IMAGE = /^data:(image\/(?:jpeg|png|webp|gif));base64,/;

/** A `data:image/...;base64,` string as an image; anything else is ignored. Only the prefix is checked, to keep CPU low on large images. */
function imageOf(data: Json): SpeedImage | undefined {
  if (typeof data !== 'string') return undefined;
  const m = DATA_IMAGE.exec(data.slice(0, 40));
  return m ? { mime: m[1] as string, dataUri: data } : undefined;
}

/** The final frame, the filmstrip and the full-page screenshot, read straight from where Lighthouse puts them. */
function screenshotsOf(ctx: AuditContext, lhr: Json, audits: Record<string, Json>, strategy: string): SpeedScreenshots | undefined {
  const out: SpeedScreenshots = {};
  const final = imageOf(audits['final-screenshot']?.details?.data);
  if (final) out.final = final;
  const frames: Json[] = audits['screenshot-thumbnails']?.details?.items ?? [];
  const filmstrip = frames
    .map((f) => ({ timingMs: Math.round(Number(f?.timing)), img: imageOf(f?.data) }))
    .filter((f): f is { timingMs: number; img: SpeedImage } => !!f.img && Number.isFinite(f.timingMs));
  if (filmstrip.length) out.filmstrip = filmstrip;
  const shot = lhr.fullPageScreenshot?.screenshot;
  const full = imageOf(shot?.data);
  if (full) {
    const cap = ctx.options.fullPageScreenshotMaxBytes;
    if (full.dataUri.length > cap) {
      const size = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
      ctx.note('speed', `Full-page screenshot (${strategy}) left out: ${size(full.dataUri.length)} is over the ${size(cap)} cap (fullPageScreenshotMaxBytes).`);
    } else {
      out.fullPage = { ...full, width: Number(shot.width) || 0, height: Number(shot.height) || 0 };
    }
  }
  return out.final || out.filmstrip || out.fullPage ? out : undefined;
}

/**
 * Passed / total for a category Lighthouse shows as a fraction (agentic
 * browsing): the way Lighthouse's own report counts it. Hidden, manual,
 * not-applicable and informative audits are not counted; an audit passes at a
 * score of 0.9 or more.
 */
function fractionOf(category: Json, audits: Record<string, Json>): { passed: number; total: number } | undefined {
  const refs: Json[] = Array.isArray(category?.auditRefs) ? category.auditRefs : [];
  let passed = 0;
  let total = 0;
  for (const ref of refs) {
    const a = audits[ref?.id];
    if (!a || ref.group === 'hidden') continue;
    const mode = String(a.scoreDisplayMode ?? '');
    if (mode === 'manual' || mode === 'notApplicable' || mode === 'informative') continue;
    total++;
    if (mode !== 'error' && typeof a.score === 'number' && a.score >= 0.9) passed++;
  }
  return total ? { passed, total } : undefined;
}

/**
 * Google's Lighthouse category scores: 0–1 scores as 0–100 integers, and a
 * category Lighthouse displays as a fraction (`categoryScoreDisplayMode`
 * `fraction`, PSI writes `FRACTION`) as passed / total. Categories not run, or
 * with a null score, are left out.
 */
export function scoresOf(categories: Json, audits: Record<string, Json> = {}): SpeedScores | undefined {
  const pct = (c: Json) => (typeof c?.score === 'number' && Number.isFinite(c.score) ? Math.round(c.score * 100) : undefined);
  const scores: SpeedScores = {};
  const map: [keyof SpeedScores, string][] = [['performance', 'performance'], ['accessibility', 'accessibility'], ['bestPractices', 'best-practices'], ['seo', 'seo']];
  for (const [key, id] of map) {
    const c = categories?.[id];
    if (/^fraction$/i.test(String(c?.categoryScoreDisplayMode ?? ''))) continue;
    const v = pct(c);
    if (v !== undefined) (scores as Record<string, number>)[key] = v;
  }
  const agentic = categories?.['agentic-browsing'];
  if (agentic) {
    const f = fractionOf(agentic, audits);
    if (f) scores.agenticBrowsing = f;
  }
  return Object.keys(scores).length ? scores : undefined;
}

/** The PageSpeed Insights web report for a URL, where the full Lighthouse trace lives. */
export function psiReportUrl(target: string, strategy: 'mobile' | 'desktop'): string {
  return `https://pagespeed.web.dev/analysis?${new URLSearchParams({ url: target, form_factor: strategy })}`;
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
    noteBoth(`PageSpeed Insights was skipped (--no-psi), so ${label} ${areas.speed && areas.accessibility ? 'were' : 'was'} not measured.`);
    return;
  }
  if (classifyHostname(ctx.pageUrl.hostname.replace(/^\[|\]$/g, ''))) {
    noteBoth(`PageSpeed Insights runs on Google's servers and cannot reach ${ctx.pageUrl.host}, so ${label} ${areas.speed && areas.accessibility ? 'were' : 'was'} not measured. Run Lighthouse locally, or audit the deployed URL.`);
    return;
  }
  // With speed, every category PSI v5 offers, for Google's score row; accessibility alone needs only its own.
  let categories = areas.speed ? [...SPEED_CATEGORIES] : ['ACCESSIBILITY'];
  const results: SpeedResult[] = [];
  let a11yDone = false;

  for (const strategy of ctx.options.strategies) {
    ctx.progress(`Running PageSpeed Insights (${strategy}); this usually takes 20-60 seconds`);
    let outcome = await callPsi(ctx, strategy, categories);
    if (!outcome.ok && !outcome.quota && categories.includes('AGENTIC_BROWSING') && /categor|invalid value/i.test(outcome.message)) {
      // The newest category; if this PSI deployment refuses it, run without it rather than lose the whole result.
      categories = categories.filter((c) => c !== 'AGENTIC_BROWSING');
      ctx.note('speed', `PageSpeed Insights refused the agentic browsing category (${strategy}), so that score is missing; the run was repeated without it.`);
      outcome = await callPsi(ctx, strategy, categories);
    }
    if (!outcome.ok) {
      results.push({ strategy, error: outcome.message, lighthouseVersion: null, metrics: [], field: null });
      noteBoth(outcome.quota
        ? `PageSpeed Insights quota exceeded (${strategy}). ${ctx.options.psiKey ? 'The key\'s daily quota is used up; try again later.' : 'Without an API key, requests share Google\'s quota; pass --psi-key or set PSI_API_KEY (Google recommends a key for automated queries).'} The rest of the report is unaffected.`
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
      const scores = scoresOf(lhr.categories, audits);
      if (scores) {
        result.scores = scores;
        result.scoreSource = SOURCES.lighthouseScoring;
      }
      if (ctx.options.screenshots) {
        const shots = screenshotsOf(ctx, lhr, audits, strategy);
        if (shots) result.screenshots = shots;
      }
      const insights: InsightDetail[] = [];
      const perf = lhr.categories?.performance;
      const refs: Json[] = perf?.auditRefs ?? [];
      const report = psiReportUrl(ctx.page.url, strategy);
      // Failing insights, used both as their own findings and to say what holds each metric back.
      const failingInsights = refs
        .filter((r) => r.group === 'insights' || r.group === 'diagnostics')
        .map((ref) => ({ ref, a: audits[ref.id] }))
        .filter(({ a }) => a && a.score !== null && a.score !== undefined && a.score < 0.5 && ['metricSavings', 'numeric', 'binary'].includes(a.scoreDisplayMode));
      const causesOf = (metricId: string): string[] => {
        const key = METRIC_SAVINGS_KEY[metricId];
        if (!key) return [];
        return failingInsights
          .map(({ a }) => ({ title: String(a.title), saving: Number(a.metricSavings?.[key] ?? 0) }))
          .filter((c) => c.saving > 0)
          .sort((x, y) => y.saving - x.saving)
          .map((c) => `${c.title} (${key === 'CLS' ? `CLS ${c.saving}` : `about ${Math.round(c.saving)} ms`})`);
      };
      for (const ref of refs.filter((r) => r.group === 'metrics')) {
        const a = audits[ref.id];
        if (!a) continue;
        const metric: LabMetric = { id: a.id ?? ref.id, title: a.title ?? ref.id, displayValue: a.displayValue ?? '', numericValue: a.numericValue ?? null, score: a.score ?? null };
        result.metrics.push(metric);
        if (metric.score === null || metric.score >= 0.9) continue;
        const causes = causesOf(metric.id);
        ctx.add({
          id: `speed/metric-${metric.id}`, area: 'speed', priority: metric.score < 0.5 ? 'should-fix' : 'nice-to-have', label: 'measured',
          title: `${metric.title}: ${metric.displayValue} (lab, ${strategy})`,
          observed: `Lighthouse rates this ${metric.score < 0.5 ? 'poor' : 'needs improvement'} (metric score ${Math.round(metric.score * 100)}/100) in one simulated ${strategy} load.`,
          why: plain(a.description),
          fix: causes.length
            ? `Start with what Lighthouse says holds it back, largest saving first (each has its own finding): ${causes.slice(0, 3).join('; ')}. Full trace: ${report}`
            : `Lighthouse names no single insight with a saving for this metric; the full trace in PageSpeed Insights shows the timeline: ${report}`,
          source: linkIn(a.description, SOURCES.webVitals),
        });
      }
      for (const { ref, a } of failingInsights) {
        const savings: Record<string, number> = a.metricSavings ?? {};
        const resources = insightResources(a);
        const big = (savings.LCP ?? 0) >= 500 || (savings.FCP ?? 0) >= 500 || (savings.CLS ?? 0) >= 0.1 || (savings.TBT ?? 0) >= 200;
        ctx.add({
          id: `speed/${ref.id}`, area: 'speed', priority: big ? 'should-fix' : 'nice-to-have', label: 'measured',
          title: `${a.title}${a.displayValue ? ` — ${a.displayValue}` : ''} (${strategy})`,
          observed: Object.keys(savings).length
            ? `Estimated savings: ${Object.entries(savings).filter(([, v]) => v).map(([k, v]) => `${k} ${k === 'CLS' ? v : `${Math.round(v)} ms`}`).join(', ') || 'none quantified'}.`
            : 'Lighthouse flags this as failing.',
          why: plain(a.description),
          fix: resources.length
            ? 'Start with the resources listed below; the linked guide shows how.'
            : `Follow the linked guide; the full trace lists the exact resources: ${report}`,
          source: linkIn(a.description, SOURCES.lighthouseInsights),
          details: resources.length ? capList(resources, 5) : undefined,
        });
        const table = insightTable(a.details, ctx.pageUrl.origin);
        insights.push({
          id: ref.id,
          group: ref.group,
          title: String(a.title ?? ref.id),
          displayValue: String(a.displayValue ?? ''),
          metricSavings: Object.fromEntries(Object.entries(savings).filter(([, v]) => typeof v === 'number' && Number.isFinite(v))),
          description: plain(a.description),
          source: linkIn(a.description, SOURCES.lighthouseInsights),
          ...(table ? { table } : {}),
        });
      }
      result.insights = insights;

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
