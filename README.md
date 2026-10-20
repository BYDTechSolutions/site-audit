# @bydtech/site-audit

One honest website audit from the terminal: SEO, AI-crawler access, structured data, link previews, speed, accessibility, security headers, installed tags and broken links, as a prioritized fix list where every item says what we saw, why it matters, how to fix it, and where that comes from.

[![npm version](https://img.shields.io/npm/v/@bydtech/site-audit.svg)](https://www.npmjs.com/package/@bydtech/site-audit)
[![CI](https://github.com/BYDTechSolutions/site-audit/actions/workflows/ci.yml/badge.svg)](https://github.com/BYDTechSolutions/site-audit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

```sh
npx @bydtech/site-audit https://example.com
```

No config, no sign-up, no score. Node.js 20 or later.

```text
Site audit: https://example.com/start
Ended at https://example.com/ (HTTP 200)
11 areas checked in 47 ms  2 fix now · 15 should fix · 11 nice to have · 2 passed

FIX NOW (2)

  1. The page asks search engines not to index it (noindex)
   [Measured] Indexability
   Saw: <meta name="robots" content="noindex, nofollow">
   Why: A noindex rule keeps the page out of Google Search entirely.
   Fix: Remove the noindex meta tag or X-Robots-Tag header if this page should appear in search.
        Keep it only on pages that must stay out.
   Source: Google: Block Search indexing with noindex <https://developers.google.com/search/docs/crawling-indexing/block-indexing>
  ...

SHOULD FIX (15)
  ...
  9. robots.txt blocks 2 AI search or assistant crawler(s)
   [Measured] AI crawler access
   Saw: Disallowed for this URL: ChatGPT-User, PerplexityBot.
   Why: These crawlers fetch pages for AI search answers and assistants. OpenAI, for example, says
        sites that opt out of OAI-SearchBot will not appear in ChatGPT search answers. Blocking
        training crawlers (GPTBot, ClaudeBot, Google-Extended, ...) is a separate choice and does
        not need these blocked.
   Fix: If that is not intended, remove the Disallow rules for these tokens (or the "User-agent: *"
        rule that catches them), and block only the training crawlers you mean to.
   Source: OpenAI: Overview of OpenAI crawlers <https://developers.openai.com/api/docs/bots>
  ...

NICE TO HAVE (11)
  ...
  21. FAQPage markup: no longer shown by Google
   [Google-documented] Structured data
   Saw: The page has FAQPage structured data.
   Why: Google deprecated FAQ rich results: they no longer appear in Google Search starting May 7,
        2026. The markup does no harm and other services may still read it, but it will not earn
        that rich result in Google.
  ...

AI CRAWLER ACCESS  (robots.txt verdict for this URL, and one request per user agent)
  Crawler              Operator     Purpose    robots.txt            Probe
  OAI-SearchBot        OpenAI       search     allowed (*)           200 different
  ChatGPT-User         OpenAI       user-fetch blocked (own group)   200 ok
  GPTBot               OpenAI       training   blocked (own group)   200 ok
  ClaudeBot            Anthropic    training   allowed (*)           403 CHALLENGED*
  PerplexityBot        Perplexity   search     blocked (own group)   403 BLOCKED
  ...
```

(Shortened, from one of the deliberately broken fixture sites in `test/`, served locally, with its address replaced by example.com. A real site takes longer: 7 to 17 seconds without PageSpeed Insights in our runs, plus however long Google takes for a PSI run.)

## Why it exists

A site owner who wants to know "is my site OK?" ends up in six free tools: PageSpeed, a schema validator, a link-preview checker, a header grader, a robots.txt tester and an "AI visibility" checker, most of them behind an email form and most of them ending in a single 0–100 score that hides which problem actually matters. This runs all of those checks on one URL in one go, ranks what it finds as **Fix now / Should fix / Nice to have**, and labels every item with its evidence:

- **Measured**: we observed it on your site during this run.
- **Google-documented**: Google's own documentation says it matters (the source links to the page).
- **Optional / speculative**: no search engine has confirmed it matters (for example llms.txt).

It also checks something few free graders do: whether AI search crawlers (OAI-SearchBot, ChatGPT-User, Claude-SearchBot, PerplexityBot, ...) can actually reach your pages, both by robots.txt and by sending one request with each crawler's user agent to catch CDN or firewall blocks.

## Install

Run it without installing:

```sh
npx @bydtech/site-audit https://example.com
```

Or add it to a project (for CI, or to use the API):

```sh
npm install --save-dev @bydtech/site-audit
npx site-audit https://example.com
```

## Quick start

```sh
# The report in the terminal
npx @bydtech/site-audit https://example.com

# A bare domain works too (https:// is added)
npx @bydtech/site-audit example.com

# One self-contained HTML file you can send to someone
npx @bydtech/site-audit https://example.com --out report.html

# Your dev server, before you deploy (speed is skipped: PageSpeed Insights cannot reach your machine)
npx @bydtech/site-audit http://localhost:3000

# With a PageSpeed Insights key, for speed and accessibility
PSI_API_KEY=your-key npx @bydtech/site-audit https://example.com

# In CI: exit 1 if anything is "Fix now"
npx @bydtech/site-audit https://staging.example.com --fail-on fix-now --no-psi
```

### Speed and accessibility need a PageSpeed Insights key

Speed and accessibility come from Google's [PageSpeed Insights API](https://developers.google.com/speed/docs/insights/v5/get-started), which runs Lighthouse on Google's servers. The tool always tries it, with or without a key. Without one, requests share Google's anonymous quota: when we tested on 2026-10-21, those requests were refused with `429 Quota exceeded`. The report still renders and says so in its notes. To get speed and accessibility results, create a free API key in the Google Cloud console (the "Get started" page above explains how) and pass it with `--psi-key` or the `PSI_API_KEY` environment variable. Google recommends a key for automated queries.

## CLI reference

```text
site-audit <url> [options]
```

| Option | Default | What it does |
|---|---|---|
| `-f, --format <fmt>` | `text` | `text`, `json`, `md` or `html` (one self-contained file: inline CSS, no scripts, no external requests). |
| `-o, --out <file>` | stdout | Write the report to a file. Without `--format`, the format comes from the extension (`.json`, `.md`, `.html`). |
| `--psi-key <key>` | `$PSI_API_KEY` | PageSpeed Insights API key. |
| `--no-psi` | PSI on | Skip PageSpeed Insights: no speed or accessibility results. |
| `--desktop` | mobile only | Also run PageSpeed Insights for desktop. |
| `--only <areas>` | all | Comma-separated areas: `indexability`, `meta`, `structured-data`, `ai-crawlers`, `robots-sitemaps`, `llms-txt`, `speed`, `accessibility`, `security`, `tags`, `links`. |
| `--fail-on <level>` | off | Exit 1 when any finding is at `fix-now`, or at `should-fix` or above. |
| `--max-links <n>` | `100` | Most links on the page to check. |
| `--timeout <ms>` | `15000` | Timeout per request. |
| `--no-probe` | probe on | Skip the one-request-per-AI-crawler user-agent probe. |
| `--no-color` | auto | Plain text. Colors are also off when stdout is not a terminal or `NO_COLOR` is set. |
| `-q, --quiet` | off | No progress messages (they go to stderr, and only on a terminal). |
| `-h, --help`, `-v, --version` | | |

**Exit codes:** `0` the audit ran (whatever it found), `1` the `--fail-on` threshold was met, `2` bad usage, or the page itself could not be fetched (DNS, connection, timeout, too many redirects, or a blocked private address).

**Your own machine.** When the URL is `localhost`, `127.0.0.1` or `[::1]`, the CLI allows private addresses on purpose, so you can audit a dev server. There, missing security headers are listed as "Nice to have", because in production they usually come from your host or CDN, and a canonical or sitemap entry on your production domain counts when the path matches. For every other URL, private, loopback, link-local and cloud-metadata addresses are refused, including after redirects and including public hostnames that resolve to them.

## API reference

```ts
import { audit, formatReport } from '@bydtech/site-audit';
import { resolveHost } from '@bydtech/site-audit/node';

const report = await audit('https://example.com', {
  psiKey: process.env.PSI_API_KEY,
  resolveHost, // Node: also block public names that resolve to private IPs
});

for (const f of report.findings.filter((f) => f.priority === 'fix-now')) {
  console.log(`${f.title} [${f.label}] — ${f.fix} (${f.source.url})`);
}
console.log(formatReport(report, 'md'));
```

### `audit(url, options?): Promise<Report>`

Audits one URL. `url` may omit the scheme. Private and loopback targets are refused by default; to audit your own dev server from code, pass `allowPrivate: true`. It throws `SiteAuditError` (with `code` `INVALID_URL`, `BLOCKED` or `FETCH`) only when the page itself cannot be fetched; everything else, including a failed PageSpeed Insights call, ends up in the report.

A `Report` has:

| Field | |
|---|---|
| `url`, `finalUrl` | The URL audited, and where redirects ended. |
| `findings: Finding[]` | Sorted by priority, then area. |
| `passed: Passed[]` | Checks that ran and found nothing (`{ id, area, title }`). |
| `notes: Note[]` | What the reader should know about the run: skipped areas, quota errors, limits. |
| `data` | The share-card preview, the AI-crawler table, PSI lab and field metrics, detected tags, link and sitemap totals. |
| `areas`, `startedAt`, `durationMs`, `tool` | Run metadata. |

A `Finding` is `{ id, area, priority, label, title, observed, why, fix, source: { title, url }, details? }`. `id` is stable (`indexability/noindex`, `ai-crawlers/firewall-blocks`, ...), so you can filter or baseline on it. There is no score field, on purpose.

### Other exports

- `formatReport(report, format, { color?, width? })`: `text`, `json`, `md` or `html`. Also `formatText`, `formatMarkdown`, `formatHtml`.
- `normalizeUrl(input)`: adds `https://` (or `http://` for local hosts).
- `SiteAuditError`, and the types `Report`, `Finding`, `AuditOptions`, `Area`, `Priority`, `Label` and the rest.
- The facts the rules use, with their sources: `BOTS`, `RICH_RESULT_TYPES`, `RETIRED_TYPES`, `CORE_WEB_VITALS`, `TAG_SIGNATURES`, `SOURCES`, `FACTS_VERIFIED_ON`.
- Helpers: `parseRobots`, `robotsVerdict`, `detectTags`, `classifyHostname`, `classifyIp`.
- `@bydtech/site-audit/node`: `resolveHost`, a resolver built on `node:dns`.

## Configuration

Every `AuditOptions` field is optional:

| Option | Default | |
|---|---|---|
| `allowPrivate` | `false` | Allow private, loopback, link-local and metadata targets (the CLI sets it for local hosts only). |
| `resolveHost` | none | `(hostname) => Promise<string[]>`. With it, names that resolve to private addresses are blocked too. Without it, only literal IPs and reserved names (`localhost`, `*.local`, `*.internal`, ...) are. |
| `psiKey` | none | PageSpeed Insights API key. |
| `psi` | `true` | Run PageSpeed Insights. |
| `strategies` | `['mobile']` | `'mobile'` and/or `'desktop'`. |
| `only` | all areas | Areas to run. |
| `maxLinks` | `100` | Most links to check. |
| `linkConcurrency` | `4` | Link checks at once. |
| `maxRedirects` | `10` | Per request. |
| `maxBodyBytes` | `5000000` | Most bytes read from one response. |
| `timeoutMs` | `15000` | Per request. |
| `psiTimeoutMs` | `120000` | Per PageSpeed Insights call. |
| `probeCrawlers` | `true` | Send one request per AI crawler user agent. |
| `probeDelayMs` | `250` | Pause between probe requests. |
| `fetch` | global `fetch` | A `fetch` to use instead (for tests or a custom agent). |
| `onProgress` | none | Called with short progress messages. |

## How it works, and its limits

One URL, no crawl. The page is fetched once with a `User-Agent` that names this tool and its repository (`site-audit/<version> (+https://github.com/BYDTechSolutions/site-audit)`). Anything beyond that URL (links, the share image, `/sitemap.xml`, `/llms.txt`) is fetched only if the site's robots.txt allows the `site-audit` token.

| Area | What is checked | Label |
|---|---|---|
| Indexability | Status code, redirect chain and temporary redirects, `noindex` (meta and `X-Robots-Tag`), robots.txt blocking Googlebot, canonical (missing, several, outside `<head>`, relative, pointing elsewhere or at a URL that does not answer 200), hreflang (code format, absolute URLs, self-reference) | Measured |
| Meta & link previews | `<title>` and meta description (missing, duplicated, long), the four required Open Graph tags, `og:image` (absolute, loads as an image, pixel size, `og:image:alt`), and a share-card preview | Measured |
| Structured data | JSON-LD parse errors; required properties for Google's supported types (Article, Breadcrumb, Event, Local business, Organization, Product snippet, Recipe, Video, Job posting, Software app, Review snippet); types Google no longer shows (FAQPage, HowTo, SpecialAnnouncement, ClaimReview, Dataset) | Google-documented |
| AI crawler access | Per crawler, the robots.txt verdict for this URL, and one request with its user agent compared with a normal request (refused, challenged with `cf-mitigated: challenge`, or a much smaller page with a different title) | Measured (the probe is indicative: real bots come from their own IP ranges) |
| robots.txt & sitemaps | robots.txt status, size (500 KiB), lines Google ignores, rules outside a group; declared sitemaps (or `/sitemap.xml`), sitemap indexes and gzip, validity, the 50,000-URL / 50 MB limits, relative URLs, `lastmod` sanity, whether this page is listed | Measured |
| llms.txt | Present? Linted against the proposal with [`@bydtech/llms-txt`](https://github.com/BYDTechSolutions/llms-txt) | Optional / speculative |
| Speed | Lighthouse lab metrics and failing insights from PageSpeed Insights; Chrome UX Report field data when Google has enough real-user traffic, otherwise "not enough real-user traffic for field data" | Measured (lab) / Google-documented (field thresholds) |
| Accessibility | Failing Lighthouse accessibility audits from the same PSI run, with the failing elements | Measured |
| Security headers | HTTPS, HSTS, CSP (missing, report-only, `unsafe-inline`/`unsafe-eval`/wildcards), clickjacking (`frame-ancestors` / `X-Frame-Options`), `nosniff`, Referrer-Policy, Permissions-Policy, `X-XSS-Protection`, version-revealing headers, cookie flags, mixed content | Measured |
| Installed tags | 63 MIT signatures written for this package: analytics, tag managers, ad pixels, consent managers, chat widgets, session replay and common embeds | Measured |
| Broken links | Every `<a href>` on the page (up to `--max-links`), HEAD then GET, 4 at a time; 401/403/429 count as "unverified", not broken | Measured |

**Sources.** Every external fact a rule relies on (crawler tokens and user agents, rich-result types and their required properties, Core Web Vitals thresholds, the PSI request and response shape) was read from its primary source on 2026-10-21 (`FACTS_VERIFIED_ON`) and is linked from the rule and from each finding. The crawler list holds only bots whose operator documents them: OpenAI, Anthropic, Perplexity, Google-Extended, Apple, Meta, Amazon and Common Crawl. Where an operator publishes no full user agent (Anthropic, Apple's Applebot, Amazon), the probe sends one that contains the token and the report marks it. Robots-only tokens (Google-Extended, Applebot-Extended) get a robots.txt verdict and no probe.

**Safety.** Only `http` and `https`. Private, loopback, link-local, carrier-grade NAT, documentation and cloud-metadata ranges (IPv4 and IPv6, including IPv4-mapped, NAT64 and 6to4 forms) are refused unless `allowPrivate` is on, and every redirect is checked again. With `resolveHost`, hostnames are resolved and every address is checked; the request itself then resolves the name again, so a DNS answer that changes between the two (rebinding) is not caught. A service that runs this for strangers should also pin the resolved address at the network layer. Requests are capped: 10 redirects, 5 MB per response (50 MB for sitemaps), 15 s per request, 100 links, 5 sitemap files, robots.txt from at most 30 linked hosts.

**What it does not do.** It reads HTML as the server sends it and runs no JavaScript, so content or tags added in the browser are not seen. It audits one URL, not a whole site. It has no Search Console data, backlinks or rankings. Automated accessibility checks catch only part of accessibility problems. It makes no promise about rankings or AI citations: it reports what is there.

**Runs at the edge.** The main entry uses web-standard APIs only (`fetch`, `URL`, streams, `DecompressionStream`), so the engine can run in Cloudflare Workers or similar. Two caveats: `@bydtech/site-audit/node` and the CLI need Node, and the llms.txt linter is loaded lazily from `@bydtech/llms-txt`, whose entry imports Node built-ins; in a runtime without them, the llms.txt check reports the file's presence and notes that it could not lint it.

**Dependencies.** One runtime dependency, [`@bydtech/llms-txt`](https://www.npmjs.com/package/@bydtech/llms-txt), for the llms.txt lint (same maintainer, no dependencies of its own). HTML is read by a small tokenizer in this package, because the checks need tags, attributes and the text of `<title>` and `<script>`, not a DOM.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)

---

Maintained by [BYD Tech](https://bydtech.in), a software studio that builds MVPs, AI agents, and web & mobile apps.
