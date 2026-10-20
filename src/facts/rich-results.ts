/*
 * Google rich-result types and their required properties, from each
 * feature's page in Google's search gallery, and the types Google stopped
 * showing, from its documentation changelog. Checked on FACTS_VERIFIED_ON.
 *
 * Only these types get required-property checks. Others are listed in the
 * report as found, without a verdict: we do not guess requirements.
 */
import type { Source } from '../types.js';

const doc = (path: string) => `https://developers.google.com/search/docs/appearance/structured-data/${path}`;

/** A supported rich-result type with the properties Google lists as required. */
export interface RichResultType {
  feature: string;
  /** schema.org `@type` values this rule applies to. */
  types: string[];
  /**
   * Each inner list is one requirement; it is met when any of its paths is
   * present. Dotted paths reach into nested objects (`location.address`).
   */
  required: string[][];
  source: Source;
}

/** The required-property rules. */
export const RICH_RESULT_TYPES: readonly RichResultType[] = [
  { feature: 'Article', types: ['Article', 'NewsArticle', 'BlogPosting'], required: [], source: { title: 'Google: Article structured data', url: doc('article') } },
  { feature: 'Breadcrumb', types: ['BreadcrumbList'], required: [['itemListElement']], source: { title: 'Google: Breadcrumb structured data', url: doc('breadcrumb') } },
  { feature: 'Event', types: ['Event'], required: [['name'], ['startDate'], ['location'], ['location.address']], source: { title: 'Google: Event structured data', url: doc('event') } },
  { feature: 'Local business', types: ['LocalBusiness'], required: [['name'], ['address']], source: { title: 'Google: Local business structured data', url: doc('local-business') } },
  { feature: 'Organization', types: ['Organization'], required: [], source: { title: 'Google: Organization structured data', url: doc('organization') } },
  { feature: 'Product snippet', types: ['Product'], required: [['name'], ['review', 'aggregateRating', 'offers']], source: { title: 'Google: Product snippet structured data', url: doc('product-snippet') } },
  { feature: 'Recipe', types: ['Recipe'], required: [['name'], ['image']], source: { title: 'Google: Recipe structured data', url: doc('recipe') } },
  { feature: 'Video', types: ['VideoObject'], required: [['name'], ['thumbnailUrl'], ['uploadDate']], source: { title: 'Google: Video structured data', url: doc('video') } },
  {
    feature: 'Job posting', types: ['JobPosting'],
    required: [['datePosted'], ['description'], ['hiringOrganization'], ['jobLocation', 'applicantLocationRequirements'], ['title']],
    source: { title: 'Google: Job posting structured data', url: doc('job-posting') },
  },
  { feature: 'Software app', types: ['SoftwareApplication'], required: [['name'], ['offers.price'], ['aggregateRating', 'review']], source: { title: 'Google: Software app structured data', url: doc('software-app') } },
  {
    feature: 'Review snippet', types: ['Review'],
    required: [['author'], ['itemReviewed'], ['itemReviewed.name'], ['reviewRating'], ['reviewRating.ratingValue']],
    source: { title: 'Google: Review snippet structured data', url: doc('review-snippet') },
  },
  {
    feature: 'Review snippet (aggregate rating)', types: ['AggregateRating'],
    required: [['itemReviewed'], ['itemReviewed.name'], ['ratingCount', 'reviewCount'], ['ratingValue']],
    source: { title: 'Google: Review snippet structured data', url: doc('review-snippet') },
  },
];

/** Required properties of an `AggregateRating` nested in another item (no `itemReviewed` needed). */
export const NESTED_AGGREGATE_RATING: string[][] = [['ratingCount', 'reviewCount'], ['ratingValue']];

/** A type Google no longer shows as a rich result. */
export interface RetiredType {
  type: string;
  feature: string;
  /** What Google said, and when. */
  status: string;
  source: Source;
}

const updates = { title: 'Google Search Central: Latest documentation updates', url: 'https://developers.google.com/search/updates' };

/** Types whose rich result Google stopped showing (or is phasing out). */
export const RETIRED_TYPES: readonly RetiredType[] = [
  { type: 'FAQPage', feature: 'FAQ', status: 'Google deprecated FAQ rich results: they no longer appear in Google Search starting May 7, 2026.', source: updates },
  { type: 'HowTo', feature: 'How-to', status: 'Google removed the How-to rich result in September 2023; it is no longer shown in search results.', source: updates },
  { type: 'SpecialAnnouncement', feature: 'Special announcement', status: 'Google deprecated the special announcement feature from July 31, 2025, and removed its documentation in September 2025.', source: updates },
  { type: 'ClaimReview', feature: 'Fact check (ClaimReview)', status: 'Google announced in June 2025 that it is phasing out ClaimReview in Search results.', source: updates },
  { type: 'Dataset', feature: 'Dataset', status: 'Google is phasing Dataset out of Google Search results (November 2025); the markup is used by Dataset Search only.', source: updates },
];
