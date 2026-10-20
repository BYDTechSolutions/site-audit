import { describe, expect, it } from 'vitest';
import { matchPath, parseRobots, robotsVerdict } from '../src/robots.js';

const ROBOTS = `Disallow: /orphan
User-agent: *
Disallow: /private
Allow: /private/public

User-agent: GPTBot
User-agent: CCBot
Disallow: /

User-agent: gptbot
Allow: /blog$
Crawl-delay: 5
Host: example.com
nonsense line
Sitemap: https://example.com/sitemap.xml
`;

describe('robots.txt', () => {
  const robots = parseRobots(ROBOTS);

  it('parses groups, sitemaps and issues', () => {
    expect(robots.sitemaps).toEqual(['https://example.com/sitemap.xml']);
    expect(robots.groups[1]?.agents).toEqual(['gptbot', 'ccbot']);
    expect(robots.issues.map((i) => i.kind)).toEqual(['rule-outside-group', 'crawl-delay', 'unknown-field', 'syntax']);
  });

  it('applies the most specific group, merges groups for one agent, longest rule wins', () => {
    expect(robotsVerdict(robots, 'GPTBot', '/').allowed).toBe(false);
    expect(robotsVerdict(robots, 'GPTBot', '/blog').allowed).toBe(true);
    expect(robotsVerdict(robots, 'GPTBot', '/blog/post').allowed).toBe(false);
    expect(robotsVerdict(robots, 'ClaudeBot', '/private/x')).toMatchObject({ allowed: false, group: '*' });
    expect(robotsVerdict(robots, 'ClaudeBot', '/private/public/a').allowed).toBe(true);
    expect(robotsVerdict(robots, 'ClaudeBot', '/robots.txt').allowed).toBe(true);
    expect(robotsVerdict(parseRobots(''), 'x', '/').group).toBe('none');
  });

  it('matches wildcards and anchors', () => {
    expect(matchPath('/*.pdf$', '/a/b.pdf')).toBe(true);
    expect(matchPath('/*.pdf$', '/a/b.pdf?x')).toBe(false);
    expect(matchPath('/blog', '/blogging')).toBe(true);
    expect(matchPath('/$', '/x')).toBe(false);
  });
});
