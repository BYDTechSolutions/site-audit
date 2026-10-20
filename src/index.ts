/**
 * One honest website audit: SEO, AI-crawler access, structured data, link
 * previews, speed, accessibility, security headers, installed tags and broken
 * links, as a prioritized fix list where every item carries an evidence label
 * and a source. No overall score.
 *
 * This entry uses web-standard APIs only (`fetch`, `URL`, streams), so it runs
 * in Node.js 20+ and in edge runtimes. Node-only helpers live in
 * `@bydtech/site-audit/node`.
 *
 * @packageDocumentation
 */
export { audit, normalizeUrl } from './audit.js';
export { SiteAuditError, type SiteAuditErrorCode } from './errors.js';
export { FORMATS, formatHtml, formatMarkdown, formatReport, formatText, type ReportFormat, type TextOptions } from './render/index.js';
export { BOTS, type BotFact } from './facts/bots.js';
export { RETIRED_TYPES, RICH_RESULT_TYPES, type RetiredType, type RichResultType } from './facts/rich-results.js';
export { CORE_WEB_VITALS, type Threshold } from './facts/cwv.js';
export { TAG_SIGNATURES, type TagSignature } from './facts/tags.js';
export { FACTS_VERIFIED_ON, SOURCES } from './facts/sources.js';
export { classifyHostname, classifyIp, isLocalDevHost } from './net/ip.js';
export { parseRobots, robotsVerdict, type RobotsGroup, type RobotsIssue, type RobotsRule, type RobotsTxt, type RobotsVerdict } from './robots.js';
export { detectTags } from './checks/tags.js';
export {
  AREAS,
  AREA_NAMES,
  LABEL_NAMES,
  PRIORITIES,
  PRIORITY_NAMES,
  type Area,
  type AuditOptions,
  type CrawlerRow,
  type DetectedTag,
  type FieldMetric,
  type Finding,
  type Hop,
  type LabMetric,
  type Label,
  type LinkSummary,
  type Note,
  type PageInfo,
  type Passed,
  type Priority,
  type Report,
  type ReportData,
  type ResolveHost,
  type SharePreview,
  type SitemapSummary,
  type Source,
  type SpeedResult,
  type TagCategory,
} from './types.js';
export { PRODUCT_TOKEN, REPO_URL, USER_AGENT, VERSION } from './version.js';
