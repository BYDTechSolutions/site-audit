/*
 * AI and link-preview crawlers, each from its operator's own documentation
 * (checked on FACTS_VERIFIED_ON). Only bots whose token we could confirm on a
 * primary source are listed. `userAgent` is the operator's published string;
 * when none is published, the probe sends a string that contains the token
 * and says so in the report.
 */
import type { CrawlerRow, Source } from '../types.js';
import { SOURCES } from './sources.js';

/** One crawler the AI-access check knows. */
export interface BotFact {
  /** The robots.txt product token, as the operator writes it. */
  token: string;
  operator: string;
  purpose: CrawlerRow['purpose'];
  role: string;
  /** `may-not`: the operator says user-triggered fetches may ignore robots.txt. `not-stated`: the operator does not say. */
  followsRobots: 'yes' | 'may-not' | 'not-stated';
  /** The full HTTP user agent the operator publishes, or `null` when it publishes none. */
  userAgent: string | null;
  /** False for robots.txt-only tokens (no HTTP user agent of their own) — nothing to probe. */
  probe: boolean;
  source: Source;
}

/** The crawlers, grouped by operator. */
export const BOTS: readonly BotFact[] = [
  {
    token: 'OAI-SearchBot', operator: 'OpenAI', purpose: 'search', role: 'ChatGPT search results', followsRobots: 'yes', probe: true,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot',
    source: SOURCES.openaiBots,
  },
  {
    token: 'ChatGPT-User', operator: 'OpenAI', purpose: 'user-fetch', role: 'fetches a page when a ChatGPT user asks', followsRobots: 'may-not', probe: true,
    userAgent: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot',
    source: SOURCES.openaiBots,
  },
  {
    token: 'GPTBot', operator: 'OpenAI', purpose: 'training', role: 'training data for OpenAI models', followsRobots: 'yes', probe: true,
    userAgent: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot',
    source: SOURCES.openaiBots,
  },
  {
    token: 'OAI-AdsBot', operator: 'OpenAI', purpose: 'ads', role: 'checks landing pages submitted as ChatGPT ads', followsRobots: 'not-stated', probe: false,
    userAgent: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-AdsBot/1.0; +https://openai.com/adsbot',
    source: SOURCES.openaiBots,
  },
  {
    token: 'Claude-SearchBot', operator: 'Anthropic', purpose: 'search', role: 'Claude search result quality', followsRobots: 'yes', probe: true,
    userAgent: null, source: SOURCES.anthropicBots,
  },
  {
    token: 'Claude-User', operator: 'Anthropic', purpose: 'user-fetch', role: 'fetches a page when a Claude user asks', followsRobots: 'yes', probe: true,
    userAgent: null, source: SOURCES.anthropicBots,
  },
  {
    token: 'ClaudeBot', operator: 'Anthropic', purpose: 'training', role: 'training data for Anthropic models', followsRobots: 'yes', probe: true,
    userAgent: null, source: SOURCES.anthropicBots,
  },
  {
    token: 'PerplexityBot', operator: 'Perplexity', purpose: 'search', role: 'Perplexity search results', followsRobots: 'yes', probe: true,
    userAgent: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
    source: SOURCES.perplexityBots,
  },
  {
    token: 'Perplexity-User', operator: 'Perplexity', purpose: 'user-fetch', role: 'fetches a page when a Perplexity user asks', followsRobots: 'may-not', probe: true,
    userAgent: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)',
    source: SOURCES.perplexityBots,
  },
  {
    token: 'Google-Extended', operator: 'Google', purpose: 'training', role: 'Gemini training and grounding (not Google Search)', followsRobots: 'yes', probe: false,
    userAgent: null, source: SOURCES.googleCrawlers,
  },
  {
    token: 'Applebot', operator: 'Apple', purpose: 'search', role: 'Apple search crawling', followsRobots: 'yes', probe: true,
    userAgent: null, source: SOURCES.appleBots,
  },
  {
    token: 'Applebot-Extended', operator: 'Apple', purpose: 'training', role: 'Apple foundation model training (not search)', followsRobots: 'yes', probe: false,
    userAgent: null, source: SOURCES.appleBots,
  },
  {
    token: 'meta-webindexer', operator: 'Meta', purpose: 'search', role: 'Meta AI search results', followsRobots: 'not-stated', probe: true,
    userAgent: 'meta-webindexer/1.1', source: SOURCES.metaBots,
  },
  {
    token: 'meta-externalfetcher', operator: 'Meta', purpose: 'user-fetch', role: 'fetches a link at a user\'s request', followsRobots: 'may-not', probe: true,
    userAgent: 'meta-externalfetcher/1.1', source: SOURCES.metaBots,
  },
  {
    token: 'meta-externalagent', operator: 'Meta', purpose: 'training', role: 'AI model training and product indexing', followsRobots: 'not-stated', probe: true,
    userAgent: 'meta-externalagent/1.1', source: SOURCES.metaBots,
  },
  {
    token: 'facebookexternalhit', operator: 'Meta', purpose: 'preview', role: 'link previews when your page is shared on Meta apps', followsRobots: 'yes', probe: true,
    userAgent: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', source: SOURCES.metaBots,
  },
  {
    token: 'Amzn-SearchBot', operator: 'Amazon', purpose: 'search', role: 'search in Amazon products such as Alexa', followsRobots: 'yes', probe: true,
    userAgent: null, source: SOURCES.amazonBots,
  },
  {
    token: 'Amzn-User', operator: 'Amazon', purpose: 'user-fetch', role: 'fetches live information for a user request', followsRobots: 'may-not', probe: true,
    userAgent: null, source: SOURCES.amazonBots,
  },
  {
    token: 'Amazonbot', operator: 'Amazon', purpose: 'training', role: 'Amazon products and services, may include AI training', followsRobots: 'yes', probe: true,
    userAgent: null, source: SOURCES.amazonBots,
  },
  {
    token: 'CCBot', operator: 'Common Crawl', purpose: 'other', role: 'the Common Crawl open web dataset', followsRobots: 'yes', probe: true,
    userAgent: 'CCBot/2.0 (https://commoncrawl.org/faq/)', source: SOURCES.ccbot,
  },
];

/** The user agent the probe sends for a bot: its published string, or one that carries the token. */
export function probeUserAgent(bot: BotFact, repoUrl: string): { userAgent: string; kind: 'documented' | 'token-only' } {
  if (bot.userAgent) return { userAgent: bot.userAgent, kind: 'documented' };
  return { userAgent: `Mozilla/5.0 (compatible; ${bot.token}; +${repoUrl})`, kind: 'token-only' };
}
