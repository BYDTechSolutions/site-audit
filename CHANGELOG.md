# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/BYDTechSolutions/site-audit/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/BYDTechSolutions/site-audit/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/BYDTechSolutions/site-audit/releases/tag/v0.1.1
[0.1.0]: https://github.com/BYDTechSolutions/site-audit/tree/fde13b6d018830fcd9eec39a1f58f2f5149f90a4
