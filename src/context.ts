/*
 * The state one audit shares between its checks: the fetched page, the parsed
 * HTML, robots.txt, and the lists findings are collected into.
 */
import type { PageDoc } from './html.js';
import { decodeText, safeFetch, type FetchContext, type Fetched } from './net/fetcher.js';
import { parseRobots, robotsPath, robotsVerdict, type RobotsTxt } from './robots.js';
import type { Area, Finding, Note, Passed, ReportData } from './types.js';
import { PRODUCT_TOKEN } from './version.js';

/** robots.txt for one origin, as fetched. */
export interface RobotsFile {
  url: string;
  /** HTTP status, or `null` when the request failed. */
  status: number | null;
  bytes: number;
  text: string;
  /** Parsed rules when the file was served (2xx); `null` otherwise. */
  parsed: RobotsTxt | null;
  error: string | null;
}

/** Resolved options a check can read. */
export interface CheckOptions {
  psi: boolean;
  psiKey?: string;
  strategies: ('mobile' | 'desktop')[];
  maxLinks: number;
  linkConcurrency: number;
  psiTimeoutMs: number;
  probeDelayMs: number;
  probeCrawlers: boolean;
}

/** What every check receives. */
export interface AuditContext {
  net: FetchContext;
  options: CheckOptions;
  page: Fetched;
  pageUrl: URL;
  html: string;
  doc: PageDoc;
  isHtml: boolean;
  data: ReportData;
  add(finding: Finding): void;
  pass(id: string, area: Area, title: string): void;
  note(area: Area | 'general', message: string): void;
  progress(message: string): void;
  /** robots.txt for an origin, fetched once per audit. */
  robotsFor(origin: string): Promise<RobotsFile>;
  /** Whether robots.txt on that URL's origin lets this tool fetch it. Unreachable robots.txt counts as allowed. */
  mayFetch(url: string): Promise<boolean>;
}

/** Collected output of the checks. */
export interface Collected {
  findings: Finding[];
  passed: Passed[];
  notes: Note[];
}

/** Builds the shared context for one audit. */
export function createAuditContext(init: {
  net: FetchContext;
  options: CheckOptions;
  page: Fetched;
  doc: PageDoc;
  html: string;
  isHtml: boolean;
  data: ReportData;
  onProgress?: (message: string) => void;
}): { ctx: AuditContext; collected: Collected } {
  const collected: Collected = { findings: [], passed: [], notes: [] };
  const robotsCache = new Map<string, Promise<RobotsFile>>();
  const robotsFor = (origin: string): Promise<RobotsFile> => {
    let pending = robotsCache.get(origin);
    if (!pending) {
      const url = `${origin}/robots.txt`;
      pending = safeFetch(init.net, url, { accept: 'text/plain,*/*', maxBytes: 600 * 1024 })
        .then((res): RobotsFile => {
          const text = decodeText(res.body, res.contentType);
          const ok = res.status >= 200 && res.status < 300;
          return { url, status: res.status, bytes: res.body.byteLength, text, parsed: ok ? parseRobots(text) : null, error: null };
        })
        .catch((error: Error): RobotsFile => ({ url, status: null, bytes: 0, text: '', parsed: null, error: error.message }));
      robotsCache.set(origin, pending);
    }
    return pending;
  };
  const ctx: AuditContext = {
    net: init.net,
    options: init.options,
    page: init.page,
    pageUrl: new URL(init.page.url),
    html: init.html,
    doc: init.doc,
    isHtml: init.isHtml,
    data: init.data,
    add: (finding) => collected.findings.push(finding),
    pass: (id, area, title) => collected.passed.push({ id, area, title }),
    note: (area, message) => collected.notes.push({ area, message }),
    progress: (message) => init.onProgress?.(message),
    robotsFor,
    mayFetch: async (url) => {
      const u = new URL(url);
      const robots = await robotsFor(u.origin);
      if (!robots.parsed) return true;
      return robotsVerdict(robots.parsed, PRODUCT_TOKEN, robotsPath(u)).allowed;
    },
  };
  return { ctx, collected };
}

/** Shortens a string for display. */
export function clip(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Caps a list for `details`, saying how many were left out. */
export function capList(items: string[], max = 10): string[] {
  if (items.length <= max) return items;
  return [...items.slice(0, max), `…and ${items.length - max} more`];
}
