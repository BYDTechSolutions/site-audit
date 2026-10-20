/*
 * Every external fact a rule relies on links to the primary source it was
 * checked against. All of these were read on the date below; when a source
 * changes, the rule that cites it changes with it.
 */
import type { Source } from '../types.js';

/** The day the facts in `src/facts/` were last checked against their sources. */
export const FACTS_VERIFIED_ON = '2026-10-21';

const s = (title: string, url: string): Source => ({ title, url });

/** The sources the rules cite, by key. */
export const SOURCES = {
  googleRobots: s('Google: How Google interprets the robots.txt specification', 'https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt'),
  googleNoindex: s('Google: Block Search indexing with noindex', 'https://developers.google.com/search/docs/crawling-indexing/block-indexing'),
  googleCanonical: s('Google: How to specify a canonical URL', 'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls'),
  googleHreflang: s('Google: Tell Google about localized versions of your page', 'https://developers.google.com/search/docs/specialty/international/localized-versions'),
  googleRedirects: s('Google: Redirects and Google Search', 'https://developers.google.com/search/docs/crawling-indexing/301-redirects'),
  googleTitle: s('Google: Influencing your title links', 'https://developers.google.com/search/docs/appearance/title-link'),
  googleSnippet: s('Google: Control your snippets in search results', 'https://developers.google.com/search/docs/appearance/snippet'),
  googleSitemaps: s('Google: Build and submit a sitemap', 'https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap'),
  googleStructuredIntro: s('Google: Introduction to structured data markup', 'https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data'),
  googleGallery: s('Google: Structured data markup that Google Search supports', 'https://developers.google.com/search/docs/appearance/structured-data/search-gallery'),
  googleUpdates: s('Google Search Central: Latest documentation updates', 'https://developers.google.com/search/updates'),
  googleAiGuide: s('Google: AI features and your website (optimization guide)', 'https://developers.google.com/search/docs/fundamentals/ai-optimization-guide'),
  googleCrawlers: s('Google: Google\'s common crawlers (Google-Extended)', 'https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers'),
  psiAbout: s('Google: About PageSpeed Insights (field data thresholds)', 'https://developers.google.com/speed/docs/insights/v5/about'),
  psiGetStarted: s('Google: Get started with the PageSpeed Insights API', 'https://developers.google.com/speed/docs/insights/v5/get-started'),
  webVitals: s('web.dev: Web Vitals', 'https://web.dev/articles/vitals'),
  lighthouseInsights: s('Chrome for Developers: Lighthouse is moving to performance insights', 'https://developer.chrome.com/blog/moving-lighthouse-to-insights'),
  lighthouseA11y: s('Chrome for Developers: Lighthouse accessibility audits', 'https://developer.chrome.com/docs/lighthouse/accessibility/'),
  a11yReview: s('web.dev: How to do an accessibility review', 'https://web.dev/articles/how-to-review'),
  ogp: s('The Open Graph protocol', 'https://ogp.me/'),
  llmstxt: s('The /llms.txt proposal', 'https://llmstxt.org/'),
  mdnHsts: s('MDN: Strict-Transport-Security', 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Strict-Transport-Security'),
  mdnCookies: s('MDN: Using HTTP cookies', 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies'),
  mdnMixed: s('MDN: Mixed content', 'https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Mixed_content'),
  owaspHeaders: s('OWASP HTTP Headers Cheat Sheet', 'https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html'),
  cloudflareChallenge: s('Cloudflare: Detect a challenge response (cf-mitigated)', 'https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/'),
  cloudflareDefaultBlock: s('Cloudflare blog: Content Independence Day (AI crawlers blocked by default, 2025-07-01)', 'https://blog.cloudflare.com/content-independence-day-no-ai-crawl-without-compensation/'),
  openaiBots: s('OpenAI: Overview of OpenAI crawlers', 'https://developers.openai.com/api/docs/bots'),
  anthropicBots: s('Anthropic: About Claude\'s web crawlers', 'https://support.claude.com/en/articles/8896518-about-claude-s-web-crawler'),
  perplexityBots: s('Perplexity: Perplexity crawlers', 'https://docs.perplexity.ai/docs/resources/perplexity-crawlers.md'),
  appleBots: s('Apple: About Applebot', 'https://support.apple.com/en-us/119829'),
  ccbot: s('Common Crawl: CCBot', 'https://commoncrawl.org/ccbot'),
  metaBots: s('Meta: Meta web crawlers', 'https://developers.facebook.com/docs/sharing/webmasters/web-crawlers/'),
  amazonBots: s('Amazon: Amazonbot and other Amazon agents', 'https://developer.amazon.com/amazonbot'),
} as const satisfies Record<string, Source>;
