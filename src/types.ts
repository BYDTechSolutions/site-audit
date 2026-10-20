/**
 * The shapes `audit` takes and returns. Everything here is plain data, so a
 * report survives `JSON.stringify` and can be rendered later, anywhere.
 */

/** The parts of a site an audit looks at. */
export type Area =
  | 'indexability'
  | 'meta'
  | 'structured-data'
  | 'ai-crawlers'
  | 'robots-sitemaps'
  | 'llms-txt'
  | 'speed'
  | 'accessibility'
  | 'security'
  | 'tags'
  | 'links';

/** Every area, in report order. */
export const AREAS: readonly Area[] = [
  'indexability',
  'meta',
  'structured-data',
  'ai-crawlers',
  'robots-sitemaps',
  'llms-txt',
  'speed',
  'accessibility',
  'security',
  'tags',
  'links',
];

/** Human names for the areas, as the reports print them. */
export const AREA_NAMES: Record<Area, string> = {
  indexability: 'Indexability',
  meta: 'Meta & link previews',
  'structured-data': 'Structured data',
  'ai-crawlers': 'AI crawler access',
  'robots-sitemaps': 'robots.txt & sitemaps',
  'llms-txt': 'llms.txt',
  speed: 'Speed',
  accessibility: 'Accessibility',
  security: 'Security headers',
  tags: 'Installed tags',
  links: 'Broken links',
};

/**
 * How soon a finding deserves attention.
 *
 * - `fix-now`: the page is broken, hidden from search, or unsafe in a way visitors or crawlers hit today.
 * - `should-fix`: a real problem with a known cost, but the page still works.
 * - `nice-to-have`: an improvement, or a choice worth confirming.
 */
export type Priority = 'fix-now' | 'should-fix' | 'nice-to-have';

/** Priorities from most to least urgent. */
export const PRIORITIES: readonly Priority[] = ['fix-now', 'should-fix', 'nice-to-have'];

/** Human names for the priorities. */
export const PRIORITY_NAMES: Record<Priority, string> = {
  'fix-now': 'Fix now',
  'should-fix': 'Should fix',
  'nice-to-have': 'Nice to have',
};

/**
 * The evidence behind a finding.
 *
 * - `measured`: we observed it on the site during this run.
 * - `google-documented`: Google's own documentation says it matters (the source links to it).
 * - `optional`: optional or speculative; no search engine has confirmed it matters (for example llms.txt).
 */
export type Label = 'measured' | 'google-documented' | 'optional';

/** Human names for the labels. */
export const LABEL_NAMES: Record<Label, string> = {
  measured: 'Measured',
  'google-documented': 'Google-documented',
  optional: 'Optional / speculative',
};

/** A primary source a rule relies on. */
export interface Source {
  title: string;
  url: string;
}

/** One thing to fix, with the evidence for it. */
export interface Finding {
  /** Stable rule id, `area/rule`, e.g. `indexability/noindex`. */
  id: string;
  area: Area;
  priority: Priority;
  label: Label;
  /** One line: what is wrong. */
  title: string;
  /** What we saw, with the values. */
  observed: string;
  /** Why it matters. */
  why: string;
  /** How to fix it. */
  fix: string;
  source: Source;
  /** Supporting lines, e.g. the broken links or the failing elements. Capped by the check. */
  details?: string[];
}

/** A check that ran and found nothing to fix. */
export interface Passed {
  id: string;
  area: Area;
  title: string;
}

/** Something the reader should know about the run itself (a skipped area, a quota error, a limit). */
export interface Note {
  area: Area | 'general';
  message: string;
}

/** One hop of a redirect chain. */
export interface Hop {
  url: string;
  status: number;
}

/** What the audited page returned. */
export interface PageInfo {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  contentType: string;
  /** Bytes read (capped by `maxBodyBytes`). */
  bytes: number;
  /** True when the body was cut at `maxBodyBytes`. */
  truncated: boolean;
  redirects: Hop[];
  /** Milliseconds from request to the end of the body. */
  timeMs: number;
}

/** What a link preview would most likely show, from the page's Open Graph and meta tags. */
export interface SharePreview {
  title: string | null;
  description: string | null;
  siteName: string | null;
  url: string;
  image: {
    url: string;
    alt: string | null;
    status: number | null;
    contentType: string | null;
    width: number | null;
    height: number | null;
    bytes: number | null;
    /** A `data:` URL of the image, when it was small enough to embed (used by the HTML report). */
    dataUrl: string | null;
  } | null;
  /** Every `og:*` and `twitter:*` tag found, as written. */
  tags: Record<string, string>;
}

/** robots.txt verdict for one crawler, plus the result of the user-agent probe. */
export interface CrawlerRow {
  token: string;
  operator: string;
  purpose: 'search' | 'user-fetch' | 'training' | 'preview' | 'ads' | 'other';
  /** What the operator says the bot does, in a few words. */
  role: string;
  /** Whether robots.txt allows this token to fetch the audited URL. `null` when there is no robots.txt to read. */
  robotsAllowed: boolean | null;
  /** The robots.txt group that applied: the token itself, `*`, or `none`. */
  robotsGroup: string;
  /** Whether the operator says the bot follows robots.txt. */
  followsRobots: 'yes' | 'may-not' | 'not-stated';
  /** The probe: one request with the bot's user agent. `null` when the bot has no HTTP user agent of its own (a robots.txt token only) or probing was skipped. */
  probe: {
    status: number | null;
    verdict: 'same' | 'blocked' | 'challenged' | 'different' | 'error';
    detail: string;
    /** `documented`: the operator's published string. `token-only`: no full string is published, so we sent one containing the token. */
    userAgentKind: 'documented' | 'token-only';
  } | null;
  source: Source;
}

/** A third-party tag found on the page. */
export interface DetectedTag {
  id: string;
  name: string;
  category: TagCategory;
  /** What matched, e.g. the script host or an ID found in the page. */
  evidence: string;
  /** Account or container IDs seen, e.g. `G-XXXX`. */
  ids: string[];
}

/** Kinds of tags the detector knows. */
export type TagCategory =
  | 'analytics'
  | 'tag-manager'
  | 'advertising'
  | 'consent'
  | 'chat'
  | 'session-replay'
  | 'other';

/** One Lighthouse metric from a PageSpeed Insights run. */
export interface LabMetric {
  id: string;
  title: string;
  displayValue: string;
  numericValue: number | null;
  /** Lighthouse's 0–1 score for this metric. */
  score: number | null;
}

/** One real-user (field) metric from the Chrome UX Report, as PageSpeed Insights returns it. */
export interface FieldMetric {
  /** The key as PSI returns it, e.g. `LARGEST_CONTENTFUL_PAINT_MS`. */
  key: string;
  name: string;
  /** The 75th percentile, in the unit PSI reports for that key. */
  percentile: number;
  /** Google's category: `FAST`, `AVERAGE`, `SLOW` or `NONE`. */
  category: string;
}

/** The speed part of the report, per strategy. */
export interface SpeedResult {
  strategy: 'mobile' | 'desktop';
  /** Set when PSI failed; the rest is then empty. */
  error: string | null;
  lighthouseVersion: string | null;
  metrics: LabMetric[];
  field: {
    /** `page` when the data is for this URL, `origin` when PSI fell back to the whole site. */
    scope: 'page' | 'origin';
    overallCategory: string | null;
    metrics: FieldMetric[];
  } | null;
}

/** Totals from the broken-link check. */
export interface LinkSummary {
  found: number;
  checked: number;
  ok: number;
  broken: number;
  /** 401, 403 and 429 answers: the site refused us, which says nothing about the link. */
  unverified: number;
  skipped: number;
  /** True when the page had more links than `maxLinks`. */
  capped: boolean;
}

/** What was read from robots.txt and the sitemaps. */
export interface SitemapSummary {
  robotsTxt: { url: string; status: number | null; bytes: number } | null;
  sitemaps: { url: string; status: number | null; kind: 'urlset' | 'index' | 'invalid' | 'unreachable'; urls: number }[];
  /** Page URLs counted across the sitemaps read. */
  totalUrls: number;
}

/** The structured, non-finding data a report carries for rendering. */
export interface ReportData {
  page: PageInfo;
  preview?: SharePreview;
  crawlers?: CrawlerRow[];
  tags?: DetectedTag[];
  speed?: SpeedResult[];
  links?: LinkSummary;
  sitemaps?: SitemapSummary;
  structuredData?: { types: string[]; blocks: number; errors: number };
  llmsTxt?: { url: string; present: boolean; errors: number; warnings: number };
}

/** What `audit` returns. There is deliberately no overall score. */
export interface Report {
  tool: { name: string; version: string; url: string };
  /** The URL as given (after adding a scheme, if it had none). */
  url: string;
  /** Where the page ended up after redirects. */
  finalUrl: string;
  /** ISO timestamp of the start of the run. */
  startedAt: string;
  durationMs: number;
  /** The areas this run covered. */
  areas: Area[];
  /** Sorted by priority, then area. */
  findings: Finding[];
  passed: Passed[];
  notes: Note[];
  data: ReportData;
}

/** Resolves a hostname to its IP addresses. The CLI uses Node's DNS; a Worker can pass its own. */
export type ResolveHost = (hostname: string) => Promise<string[]>;

/** Options for {@link audit}. Every one is optional. */
export interface AuditOptions {
  /**
   * Allow private, loopback, link-local and cloud-metadata targets, including
   * after redirects. Default `false`. The CLI turns it on only when you audit
   * `localhost`, `127.0.0.1` or `::1`, so you can check a dev server.
   */
  allowPrivate?: boolean;
  /**
   * Resolves hostnames so private addresses behind a public name are blocked too.
   * Without it only literal IPs and reserved names (`localhost`, `*.internal`, ...) are blocked.
   * `@bydtech/site-audit/node` exports one built on `node:dns`.
   */
  resolveHost?: ResolveHost;
  /** PageSpeed Insights API key. Without one PSI is still tried, on Google's shared quota. */
  psiKey?: string;
  /** Run PageSpeed Insights (speed and accessibility). Default `true`. */
  psi?: boolean;
  /** PSI strategies. Default `['mobile']`. */
  strategies?: ('mobile' | 'desktop')[];
  /** Only these areas. Default: all. */
  only?: Area[];
  /** Most links to check on the page. Default `100`. */
  maxLinks?: number;
  /** Links checked at once. Default `4`. */
  linkConcurrency?: number;
  /** Most redirects followed per request. Default `10`. */
  maxRedirects?: number;
  /** Most bytes read from any one response. Default `5_000_000`. */
  maxBodyBytes?: number;
  /** Timeout per request, in milliseconds. Default `15_000`. */
  timeoutMs?: number;
  /** Timeout for each PageSpeed Insights call, in milliseconds. Default `120_000`. */
  psiTimeoutMs?: number;
  /** Pause between AI-crawler probes, in milliseconds. Default `250`. */
  probeDelayMs?: number;
  /** Send one request per AI crawler user agent. Default `true`. */
  probeCrawlers?: boolean;
  /** A `fetch` to use instead of the global one. */
  fetch?: typeof fetch;
  /** Called with short progress messages, e.g. for a spinner. */
  onProgress?: (message: string) => void;
}
