/*
 * robots.txt as RFC 9309 and Google's documentation describe it: groups of
 * `user-agent` lines followed by `allow` / `disallow` rules; agent names match
 * case-insensitively; groups for the same agent merge; a crawler with no group
 * of its own falls back to `*`; the longest matching rule wins and `allow`
 * wins a tie. Paths are case-sensitive.
 */

/** One allow/disallow rule. */
export interface RobotsRule {
  allow: boolean;
  pattern: string;
  line: number;
}

/** A user-agent group. Agent names are lowercase. */
export interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
}

/** Something odd in the file, with its 1-based line. */
export interface RobotsIssue {
  line: number;
  kind: 'rule-outside-group' | 'unknown-field' | 'crawl-delay' | 'syntax';
  text: string;
}

/** A parsed robots.txt. */
export interface RobotsTxt {
  groups: RobotsGroup[];
  sitemaps: string[];
  issues: RobotsIssue[];
}

/** Parses robots.txt text, collecting issues instead of failing. */
export function parseRobots(text: string): RobotsTxt {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  const issues: RobotsIssue[] = [];
  let group: RobotsGroup | null = null;
  let lastWasAgent = false;
  text.replace(/^﻿/, '').split(/\r\n|\r|\n/).forEach((raw, index) => {
    const lineNo = index + 1;
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) return;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) {
      issues.push({ line: lineNo, kind: 'syntax', text: raw.trim() });
      return;
    }
    const key = (m[1] as string).toLowerCase();
    const value = (m[2] as string).trim();
    if (key === 'user-agent') {
      if (!group || !lastWasAgent) {
        group = { agents: [], rules: [] };
        groups.push(group);
      }
      group.agents.push(value.toLowerCase());
      lastWasAgent = true;
      return;
    }
    if (key === 'sitemap') {
      if (value) sitemaps.push(value);
      return;
    }
    lastWasAgent = false;
    if (key === 'allow' || key === 'disallow') {
      if (!group) {
        issues.push({ line: lineNo, kind: 'rule-outside-group', text: raw.trim() });
        return;
      }
      // An empty disallow allows everything, the same as no rule.
      if (value) group.rules.push({ allow: key === 'allow', pattern: value, line: lineNo });
      return;
    }
    if (key === 'crawl-delay') {
      issues.push({ line: lineNo, kind: 'crawl-delay', text: raw.trim() });
      return;
    }
    issues.push({ line: lineNo, kind: 'unknown-field', text: raw.trim() });
  });
  return { groups, sitemaps, issues };
}

/** Whether a robots.txt path pattern (`*` wildcard, trailing `$` anchor) matches a path. */
export function matchPath(pattern: string, path: string): boolean {
  if (!pattern) return false;
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = body
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}${anchored ? '$' : ''}`).test(path);
}

/** The verdict for one agent and path. */
export interface RobotsVerdict {
  allowed: boolean;
  /** The group that applied: the token, `*`, or `none`. */
  group: string;
  /** The rule that decided, if any. */
  rule: RobotsRule | null;
}

/**
 * Whether robots.txt lets the crawler with this product token fetch `path`
 * (path plus query). `/robots.txt` itself is always allowed.
 */
export function robotsVerdict(robots: RobotsTxt, token: string, path: string): RobotsVerdict {
  const wanted = token.toLowerCase();
  if (path === '/robots.txt') return { allowed: true, group: 'none', rule: null };
  let matched = robots.groups.filter((g) => g.agents.includes(wanted));
  let group = wanted;
  if (!matched.length) {
    matched = robots.groups.filter((g) => g.agents.includes('*'));
    group = matched.length ? '*' : 'none';
  }
  let best: RobotsRule | null = null;
  for (const rule of matched.flatMap((g) => g.rules)) {
    if (!matchPath(rule.pattern, path)) continue;
    if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) {
      best = rule;
    }
  }
  return { allowed: best ? best.allow : true, group, rule: best };
}

/** `pathname + search` of a URL, the part robots.txt rules match. */
export function robotsPath(url: string | URL): string {
  const u = typeof url === 'string' ? new URL(url) : url;
  return u.pathname + u.search;
}
