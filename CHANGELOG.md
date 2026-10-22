# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.4] - 2026-10-23

### Added

- Google's Lighthouse category scores per PSI strategy, in `data.speed[].scores`:
  performance, accessibility, best practices and SEO as 0–100 integers, and
  agentic browsing as `{ passed, total }`, the fraction Lighthouse shows for
  it. `scoreSource` links to Google's explanation. They are labeled
  everywhere as Google's Lighthouse lab score for one simulated load; they
  are data, never change a finding or its priority, and the report still has
  no overall score of its own. With speed, PSI is now asked for every current
  v5 category; if it refuses `AGENTIC_BROWSING`, the run is repeated without
  it, with a note.
- `data.speed[].insights`: every failing insight and diagnostic with its
  plain description, estimated savings, source and a normalized table
  (columns, up to 15 rows with `moreRows`, URLs shortened for display with
  the full value in `fullUrls`, elements as selector and snippet text).
- `screenshots` option (default `false`): the final frame, the filmstrip and
  the full-page screenshot as `data:` URIs. A full-page screenshot over
  `fullPageScreenshotMaxBytes` (default 1.5 MB) is dropped with a note. The
  CLI keeps screenshots for `--format html`, or with the new `--screenshots`.
- HTML report: a compact row of Google's scores per strategy under the
  summary, and a PageSpeed-style speed section: Mobile/Desktop as CSS-only
  tabs (still no scripts), score rings in Lighthouse's color bands, lab
  metric cards colored by Core Web Vitals thresholds (or Lighthouse's metric
  score where a metric has none), the filmstrip, final and full-page
  screenshots, and each insight with its table.
- Text and Markdown print the score row first in each speed section;
  Markdown also includes the insight tables.
- Exports: `rateLabMetric`, `rateLighthouseScore`, `rateCwv`,
  `labThreshold`, `SPEED_CATEGORIES`, `INSIGHT_ROW_CAP` and the new types.

### Changed

- The closing line says the scores shown are Google's Lighthouse lab scores
  and that the fix list is what to do about them, instead of "No overall
  score, on purpose". Findings are unchanged.

### Fixed

- Markdown reports print a source URL that is not http(s) as plain text instead of a link.

## [0.1.3] - 2026-10-21

### Added

- Text compression check, measured directly so it runs without a PageSpeed
  key: the page and up to 8 same-origin stylesheets and scripts. A text
  response with no br/gzip/deflate/zstd Content-Encoding is flagged when gzip
  would shrink it (Lighthouse's cut-offs: at least about 1.4 KiB and a 10%
  saving), with the size it would have gzipped. When `Cache-Control:
  no-transform` is present, the finding says it stops CDNs such as Cloudflare
  from compressing. On a local dev server it is a reminder, not a fix.

### Fixed

- "so speed were not measured" now reads "so speed was not measured".

## [0.1.2] - 2026-10-21

### Changed

- Speed findings for a lab metric (LCP, FCP, TBT, CLS) now say which failing
  insights hold it back, largest estimated saving first, instead of a generic
  "see the insights". When none does, they say so.
- Insight findings list the resources Lighthouse names (for example the
  render-blocking files), so the fix starts from the report itself.
- Every speed finding links to the full PageSpeed Insights trace for the URL.

### Fixed

- Descriptions copied from Lighthouse no longer end with a dangling
  "Learn more about…" sentence; the link is already the finding's source.

## [0.1.1] - 2026-10-21

### Changed

- Published from GitHub Actions through npm trusted publishing, with a
  provenance attestation linking the package to this repository. No code changes.

## [0.1.0] - 2026-10-21

### Added

- `site-audit <url>`: one-URL audit printed as Fix now / Should fix / Nice to have, each finding with an evidence label (Measured, Google-documented, Optional / speculative), what was seen, why it matters, how to fix it and a source link. No overall score.
- Areas: indexability, meta and link previews (with a share-card preview), structured data (required properties for Google's supported rich-result types; retired types reported as no longer shown), AI crawler access (per-bot robots.txt verdict plus a user-agent probe for CDN/firewall blocks), robots.txt and sitemaps, llms.txt (linted with `@bydtech/llms-txt`), speed and accessibility (PageSpeed Insights v5, lab and field data), security headers, installed tags (63 MIT signatures) and broken links.
- Output as text, JSON, Markdown or one self-contained HTML file; `--out`, `--only`, `--desktop`, `--psi-key` / `PSI_API_KEY`, `--no-psi`, `--no-probe`, `--fail-on fix-now|should-fix`, exit codes 0, 1 and 2.
- SSRF guard: http(s) only; private, loopback, link-local and metadata addresses refused (also after redirects, and for names that resolve to them with `resolveHost`); caps on redirects, body size, time and links. The CLI allows `localhost`, `127.0.0.1` and `::1` so you can audit a dev server.
- API: `audit`, `formatReport`, the facts each rule relies on with their sources, and `@bydtech/site-audit/node` with a `node:dns` resolver. The main entry uses web-standard APIs only.

[Unreleased]: https://github.com/BYDTechSolutions/site-audit/compare/v0.1.4...HEAD
[0.1.4]: https://github.com/BYDTechSolutions/site-audit/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/BYDTechSolutions/site-audit/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/BYDTechSolutions/site-audit/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/BYDTechSolutions/site-audit/releases/tag/v0.1.1
[0.1.0]: https://github.com/BYDTechSolutions/site-audit/tree/fde13b6d018830fcd9eec39a1f58f2f5149f90a4
