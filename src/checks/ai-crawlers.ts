import type { AuditContext } from '../context.js';
import { BOTS, probeUserAgent, type BotFact } from '../facts/bots.js';
import { SOURCES } from '../facts/sources.js';
import { parsePage } from '../html.js';
import { decodeText, safeFetch, sleep, type Fetched } from '../net/fetcher.js';
import { robotsPath, robotsVerdict } from '../robots.js';
import type { CrawlerRow } from '../types.js';
import { REPO_URL } from '../version.js';

const AREA = 'ai-crawlers' as const;

const INDICATIVE = 'Indicative only: real bots come from their own IP ranges, and a firewall may treat them differently from this probe.';

function titleOf(res: Fetched): string {
  if (!res.contentType.includes('html')) return '';
  return parsePage(decodeText(res.body, res.contentType)).titles[0]?.text ?? '';
}

function compare(baseline: Fetched, probe: Fetched): NonNullable<CrawlerRow['probe']>['verdict'] | 'same' {
  if ((probe.headers.get('cf-mitigated') ?? '').toLowerCase() === 'challenge') return 'challenged';
  const baseOk = baseline.status >= 200 && baseline.status < 300;
  const probeOk = probe.status >= 200 && probe.status < 300;
  if (baseOk && !probeOk) return 'blocked';
  if (!baseOk) return probe.status === baseline.status ? 'same' : 'different';
  if (probe.url !== baseline.url) return 'different';
  const shrunk = probe.body.byteLength < baseline.body.byteLength * 0.5;
  if (shrunk && titleOf(probe) !== titleOf(baseline)) return 'different';
  return 'same';
}

const DETAIL: Record<string, string> = {
  same: 'served the same page',
  blocked: 'refused',
  challenged: 'served a bot challenge (cf-mitigated: challenge)',
  different: 'served different content',
};

/** Per-bot robots.txt verdicts and a user-agent probe for firewall/CDN blocks. */
export async function checkAiCrawlers(ctx: AuditContext): Promise<void> {
  const robots = await ctx.robotsFor(ctx.pageUrl.origin);
  const path = robotsPath(ctx.pageUrl);
  if (robots.status !== null && robots.status >= 500) {
    ctx.note(AREA, `robots.txt answered ${robots.status}; crawlers treat that as a temporary error, so the robots verdicts below are unknown.`);
  }
  const baseline = ctx.page;
  const baselineBlocked = (baseline.headers.get('cf-mitigated') ?? '').toLowerCase() === 'challenge' || [401, 403, 429].includes(baseline.status);
  const probing = ctx.options.probeCrawlers && !baselineBlocked;
  if (ctx.options.probeCrawlers && baselineBlocked) {
    ctx.note(AREA, `The site refused this tool's own request (${baseline.status}), so the user-agent probe has nothing to compare against and was skipped.`);
  }

  const rows: CrawlerRow[] = [];
  let first = true;
  for (const bot of BOTS) {
    const verdict = robots.parsed ? robotsVerdict(robots.parsed, bot.token, path) : null;
    const row: CrawlerRow = {
      token: bot.token,
      operator: bot.operator,
      purpose: bot.purpose,
      role: bot.role,
      robotsAllowed: verdict ? verdict.allowed : robots.status !== null && robots.status >= 500 ? null : true,
      robotsGroup: verdict?.group ?? 'none',
      followsRobots: bot.followsRobots,
      probe: null,
      source: bot.source,
    };
    if (probing && bot.probe) {
      if (!first) await sleep(ctx.options.probeDelayMs);
      first = false;
      ctx.progress(`Probing as ${bot.token}`);
      const ua = probeUserAgent(bot, REPO_URL);
      try {
        const res = await safeFetch(ctx.net, baseline.url, { userAgent: ua.userAgent, accept: 'text/html,*/*', maxBytes: 1_000_000 });
        const v = compare(baseline, res);
        row.probe = {
          status: res.status,
          verdict: v,
          detail: `${res.status}: ${DETAIL[v]}${v === 'different' && res.url !== baseline.url ? ` (ended at ${res.url})` : ''}`,
          userAgentKind: ua.kind,
        };
      } catch (error) {
        row.probe = { status: null, verdict: 'error', detail: (error as Error).message, userAgentKind: ua.kind };
      }
    }
    rows.push(row);
  }
  ctx.data.crawlers = rows;

  const visible = (b: CrawlerRow | BotFact) => b.purpose === 'search' || b.purpose === 'user-fetch';
  const robotsBlocked = rows.filter((r) => visible(r) && r.robotsAllowed === false);
  if (robotsBlocked.length) {
    ctx.add({
      id: `${AREA}/robots-blocks-search`, area: AREA, priority: 'should-fix', label: 'measured',
      title: `robots.txt blocks ${robotsBlocked.length} AI search or assistant crawler(s)`,
      observed: `Disallowed for this URL: ${robotsBlocked.map((r) => r.token).join(', ')}.`,
      why: 'These crawlers fetch pages for AI search answers and assistants. OpenAI, for example, says sites that opt out of OAI-SearchBot will not appear in ChatGPT search answers. Blocking training crawlers (GPTBot, ClaudeBot, Google-Extended, ...) is a separate choice and does not need these blocked.',
      fix: 'If that is not intended, remove the Disallow rules for these tokens (or the "User-agent: *" rule that catches them), and block only the training crawlers you mean to.',
      source: SOURCES.openaiBots,
      details: robotsBlocked.map((r) => `${r.token} (${r.operator}, ${r.role}) — group "${r.robotsGroup}" — ${r.source.url}`),
    });
  }

  const probeBlocked = rows.filter((r) => (visible(r) || r.purpose === 'preview') && r.probe && (r.probe.verdict === 'blocked' || r.probe.verdict === 'challenged'));
  if (probeBlocked.length) {
    const robotsOk = probeBlocked.filter((r) => r.robotsAllowed !== false);
    ctx.add({
      id: `${AREA}/firewall-blocks`, area: AREA, priority: 'should-fix', label: 'measured',
      title: `The server or CDN refuses ${probeBlocked.length} AI search, assistant or preview user agent(s)`,
      observed: `${probeBlocked.map((r) => `${r.token}: ${r.probe?.detail}`).join('; ')}. A normal request got ${baseline.status}. ${INDICATIVE}`,
      why: `Robots.txt is not the only gate: a firewall or CDN bot rule can refuse these crawlers outright${robotsOk.length ? `, even though robots.txt allows ${robotsOk.map((r) => r.token).join(', ')}` : ''}. Cloudflare, for one, changed its default to block AI crawlers on July 1, 2025.`,
      fix: 'Check your CDN or firewall bot settings (AI crawler or bot-fight rules) and allow the crawlers you want, ideally by the operator\'s verified IP ranges rather than by user agent.',
      source: SOURCES.cloudflareDefaultBlock,
      details: probeBlocked.map((r) => `${r.token}: ${r.source.url}${r.probe?.userAgentKind === 'token-only' ? ' (no full user agent is published; we sent one containing the token)' : ''}`),
    });
  }

  const probeDifferent = rows.filter((r) => (visible(r) || r.purpose === 'preview') && r.probe?.verdict === 'different');
  if (probeDifferent.length) {
    ctx.add({
      id: `${AREA}/different-content`, area: AREA, priority: 'nice-to-have', label: 'measured',
      title: `${probeDifferent.length} AI search, assistant or preview user agent(s) got a different page`,
      observed: `${probeDifferent.map((r) => `${r.token}: ${r.probe?.detail}`).join('; ')}. A normal request got ${baseline.status} with ${baseline.body.byteLength} bytes. ${INDICATIVE}`,
      why: 'A much smaller page with a different title usually means a soft block or an interstitial for that user agent, so the crawler never sees your content. It can also be deliberate (a lighter page for bots); check which.',
      fix: 'Fetch the page with that user agent (curl -A "<user agent>" <url>) and compare; if it is a block page, adjust the CDN, firewall or app rule that serves it.',
      source: probeDifferent[0]?.source ?? SOURCES.openaiBots,
      details: probeDifferent.map((r) => `${r.token}: ${r.source.url}`),
    });
  }

  if (!robotsBlocked.length && !probeBlocked.length && !probeDifferent.length) {
    ctx.pass(`${AREA}/access`, AREA, probing ? 'AI search and assistant crawlers are allowed by robots.txt and were not refused by the probe' : 'robots.txt allows AI search and assistant crawlers');
  }
  if (probing) ctx.note(AREA, `The user-agent probe sent one request per crawler. ${INDICATIVE}`);
}
