import { capList, clip, type AuditContext } from '../context.js';
import { NESTED_AGGREGATE_RATING, RETIRED_TYPES, RICH_RESULT_TYPES, type RichResultType } from '../facts/rich-results.js';
import { SOURCES } from '../facts/sources.js';

const AREA = 'structured-data' as const;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Node = { [key: string]: Json };

const isNode = (v: Json | undefined): v is Node => !!v && typeof v === 'object' && !Array.isArray(v);

/** `schema:Product`, `https://schema.org/Product` and `Product` all become `Product`. */
function typesOf(node: Node): string[] {
  const raw = node['@type'];
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  return list.filter((t): t is string => typeof t === 'string').map((t) => t.replace(/^.*[/:#]/, ''));
}

function present(v: Json | undefined): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.some(present);
  return true;
}

/** Whether a dotted path is present, following `@id` references and arrays. */
function hasPath(node: Node, path: string, ids: Map<string, Node>): boolean {
  const [head, ...rest] = path.split('.');
  let value = node[head as string];
  if (!present(value)) return false;
  if (!rest.length) return true;
  const values = Array.isArray(value) ? value : [value];
  return values.some((v) => {
    let target: Json | undefined = v;
    if (isNode(target) && typeof target['@id'] === 'string' && Object.keys(target).length === 1) target = ids.get(target['@id']) ?? target;
    return isNode(target) && hasPath(target, rest.join('.'), ids);
  });
}

function resolve(v: Json | undefined, ids: Map<string, Node>): Json | undefined {
  if (isNode(v) && typeof v['@id'] === 'string' && Object.keys(v).length === 1) return ids.get(v['@id']) ?? v;
  return v;
}

function missingRequirements(node: Node, required: string[][], ids: Map<string, Node>): string[] {
  return required.filter((alts) => !alts.some((p) => hasPath(node, p, ids))).map((alts) => alts.join(' or '));
}

/** Extra rules Google states in prose for breadcrumbs and product offers. */
function extraProblems(node: Node, types: string[], ids: Map<string, Node>): string[] {
  const problems: string[] = [];
  if (types.includes('BreadcrumbList')) {
    const raw = node.itemListElement;
    const items = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((v) => resolve(v, ids)).filter(isNode);
    if (items.length && items.length < 2) problems.push('a BreadcrumbList needs at least two ListItems');
    items.forEach((item, index) => {
      const last = index === items.length - 1;
      const target = resolve(item.item, ids);
      if (!last && !present(item.item)) problems.push(`ListItem ${index + 1}: item (URL) is required except on the last crumb`);
      const named = present(item.name) || (isNode(target) && present(target.name));
      if (!named) problems.push(`ListItem ${index + 1}: name is required`);
    });
  }
  if (types.includes('Product') && present(node.offers)) {
    const raw = node.offers;
    const offers = (Array.isArray(raw) ? raw : [raw]).map((v) => resolve(v, ids)).filter(isNode);
    offers.forEach((offer, index) => {
      if (typesOf(offer).includes('AggregateOffer')) {
        for (const p of ['lowPrice', 'priceCurrency']) if (!present(offer[p])) problems.push(`offers[${index}] (AggregateOffer): ${p} is required`);
      } else if (!present(offer.price) && !hasPath(offer, 'priceSpecification.price', ids)) {
        problems.push(`offers[${index}]: price (or priceSpecification.price) is required`);
      }
    });
  }
  const rating = resolve(node.aggregateRating, ids);
  if (isNode(rating) && !types.includes('AggregateRating')) {
    for (const miss of missingRequirements(rating, NESTED_AGGREGATE_RATING, ids)) problems.push(`aggregateRating: ${miss} is required`);
  }
  return problems;
}

/** JSON-LD parse errors, required properties for supported rich-result types, and retired types. */
export async function checkStructuredData(ctx: AuditContext): Promise<void> {
  if (!ctx.isHtml) return;
  const blocks = ctx.doc.scripts.filter((s) => /^\s*application\/ld\+json\b/i.test(s.attrs.type ?? ''));
  const top: Node[] = [];
  const all: Node[] = [];
  const ids = new Map<string, Node>();
  let errors = 0;

  blocks.forEach((block, index) => {
    const text = block.text.trim().replace(/^<!\[CDATA\[|\]\]>$/g, '');
    let data: Json;
    try {
      data = JSON.parse(text) as Json;
    } catch (error) {
      errors++;
      ctx.add({
        id: `${AREA}/json-parse`, area: AREA, priority: 'should-fix', label: 'google-documented',
        title: `JSON-LD block ${index + 1} is not valid JSON`,
        observed: `${(error as Error).message}. Starts with: ${clip(text, 80)}`,
        why: 'Search engines cannot read structured data that does not parse; Google says markup must be valid to be eligible for rich results.',
        fix: 'Fix the JSON syntax (trailing commas, unescaped quotes and comments are the usual causes) and re-test with Google\'s Rich Results Test.',
        source: SOURCES.googleStructuredIntro,
      });
      return;
    }
    const roots = Array.isArray(data) ? data : [data];
    for (const root of roots) {
      if (!isNode(root)) continue;
      const graph = root['@graph'];
      const items = Array.isArray(graph) ? graph.filter(isNode) : [root];
      top.push(...items);
    }
  });

  const walk = (v: Json | undefined) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (isNode(v)) {
      if (typeof v['@id'] === 'string' && Object.keys(v).length > 1) ids.set(v['@id'], v);
      if (v['@type'] !== undefined) all.push(v);
      Object.entries(v).forEach(([k, child]) => k !== '@context' && walk(child));
    }
  };
  top.forEach(walk);

  const foundTypes = [...new Set(all.flatMap(typesOf))];
  ctx.data.structuredData = { types: foundTypes, blocks: blocks.length, errors };

  const microdata = ctx.doc.tags.some((t) => t.attrs.itemtype !== undefined || t.attrs.typeof !== undefined);
  if (microdata) ctx.note(AREA, 'The page also uses Microdata or RDFa. This tool checks JSON-LD only.');

  if (!blocks.length) {
    ctx.add({
      id: `${AREA}/none`, area: AREA, priority: 'nice-to-have', label: 'google-documented',
      title: 'No JSON-LD structured data',
      observed: 'No <script type="application/ld+json"> on the page.',
      why: 'Google says structured data is not required for its generative AI search features, but it does make pages eligible for rich results in Google Search.',
      fix: 'If one of Google\'s supported types fits this page (Organization, Article, Product, Breadcrumb, Event, ...), add it as JSON-LD, the format Google recommends.',
      source: SOURCES.googleAiGuide,
    });
    return;
  }

  const checked = new Set<string>();
  for (const node of top) {
    const types = typesOf(node);
    const rules: RichResultType[] = RICH_RESULT_TYPES.filter((r) => r.types.some((t) => types.includes(t)));
    for (const rule of rules) {
      const missing = missingRequirements(node, rule.required, ids);
      const extra = extraProblems(node, types, ids);
      const problems = [...missing.map((m) => `${m} is required`), ...extra];
      const label = `${rule.feature}${typeof node.name === 'string' ? ` "${clip(node.name, 40)}"` : ''}`;
      if (problems.length) {
        ctx.add({
          id: `${AREA}/required-properties`, area: AREA, priority: 'should-fix', label: 'google-documented',
          title: `${label}: required properties missing`,
          observed: `${types.join(', ')} is missing ${problems.length} required item(s).`,
          why: 'Google says an object must include all its required properties to be eligible for that rich result.',
          fix: 'Add the properties listed below, with values that match what the page shows.',
          source: rule.source,
          details: capList(problems),
        });
      } else {
        checked.add(rule.feature);
      }
    }
  }
  for (const feature of checked) ctx.pass(`${AREA}/required-properties`, AREA, `${feature}: required properties present`);

  for (const retired of RETIRED_TYPES) {
    if (!foundTypes.includes(retired.type)) continue;
    ctx.add({
      id: `${AREA}/retired-type`, area: AREA, priority: 'nice-to-have', label: 'google-documented',
      title: `${retired.type} markup: no longer shown by Google`,
      observed: `The page has ${retired.type} structured data.`,
      why: `${retired.status} The markup does no harm and other services may still read it, but it will not earn that rich result in Google.`,
      fix: 'Keep it if another consumer uses it; otherwise it can go. Do not add it expecting a Google rich result.',
      source: retired.source,
    });
  }

  if (!errors && blocks.length) ctx.pass(`${AREA}/json-parse`, AREA, `${blocks.length} JSON-LD block(s) parse`);
}
