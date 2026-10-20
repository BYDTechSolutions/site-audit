# Contributing

Thanks for helping. Issues and pull requests are welcome at
[github.com/BYDTechSolutions/site-audit](https://github.com/BYDTechSolutions/site-audit).

## Setup

```sh
npm ci
npm run typecheck
npm test
npm run build
```

Node.js 20 or later.

## Rules

- Tests never reach the network: they run against a local `node:http` server, and
  `test/setup.ts` makes any request to another host fail. PageSpeed Insights is
  mocked from the fixtures in `test/fixtures/`. Do not point a test at a real site.
- Every external fact a rule relies on (a crawler's token or user agent, a
  rich-result type or its required properties, a threshold, an API shape) lives in
  `src/facts/`, links its primary source, and was read from that source. A change
  to a fact comes with the link that supports it and an updated `FACTS_VERIFIED_ON`.
  If a fact cannot be verified from a primary source, leave the rule out.
- Labels mean what the README says: **Measured** only for what this run observed,
  **Google-documented** only with a link to Google's own documentation,
  **Optional / speculative** for anything no engine has confirmed matters.
- No overall score, and no copy that promises rankings or AI citations.
- Tag signatures are written for this package. Do not copy from Wappalyzer or its
  GPL-licensed forks.
- The main entry (`src/index.ts` and everything it imports) uses web-standard APIs
  only. Node-only code belongs in `src/node.ts` or the CLI.
- No runtime dependencies without a strong reason, stated in the README.
- Add a line to `CHANGELOG.md` under "Unreleased".
- American English in code, messages and docs.
