import { capList, type AuditContext } from '../context.js';
import { SOURCES } from '../facts/sources.js';
import { decodeText, safeFetch } from '../net/fetcher.js';

const AREA = 'llms-txt' as const;

const SPECULATIVE = 'llms.txt is a proposal, not a standard: Google says Google Search ignores these files, and whether any AI engine uses them is unconfirmed.';

/** Is there an llms.txt, and does it follow the proposal's format? Linted with @bydtech/llms-txt. */
export async function checkLlmsTxt(ctx: AuditContext): Promise<void> {
  const url = `${ctx.pageUrl.origin}/llms.txt`;
  ctx.data.llmsTxt = { url, present: false, errors: 0, warnings: 0 };
  if (!(await ctx.mayFetch(url))) {
    ctx.note(AREA, `Did not fetch ${url}: robots.txt disallows this tool.`);
    return;
  }
  let res;
  try {
    res = await safeFetch(ctx.net, url, { accept: 'text/markdown,text/plain,*/*', maxBytes: 2_000_000 });
  } catch (error) {
    ctx.note(AREA, `Could not fetch ${url}: ${(error as Error).message}`);
    return;
  }
  if (res.status < 200 || res.status >= 300) {
    ctx.note(AREA, `No llms.txt (${res.status}). That is fine: ${SPECULATIVE}`);
    return;
  }
  const text = decodeText(res.body, res.contentType);
  if (res.contentType.includes('html') || /^\s*<(!doctype|html)/i.test(text)) {
    ctx.add({
      id: `${AREA}/html`, area: AREA, priority: 'nice-to-have', label: 'optional',
      title: '/llms.txt returns an HTML page',
      observed: `${url} answered ${res.status} with HTML (often a single-page app's fallback route).`,
      why: `Anything that looks for llms.txt gets a web page instead. ${SPECULATIVE}`,
      fix: 'Return 404 for /llms.txt, or publish a real Markdown file there.',
      source: SOURCES.llmstxt,
    });
    return;
  }
  ctx.data.llmsTxt.present = true;
  let lint: typeof import('@bydtech/llms-txt').lint;
  try {
    ({ lint } = await import('@bydtech/llms-txt'));
  } catch (error) {
    ctx.note(AREA, `llms.txt found, but the linter could not load in this runtime: ${(error as Error).message}`);
    return;
  }
  const result = lint(text, { baseUrl: res.url });
  ctx.data.llmsTxt.errors = result.errors;
  ctx.data.llmsTxt.warnings = result.warnings;
  if (result.issues.length) {
    ctx.add({
      id: `${AREA}/lint`, area: AREA, priority: 'nice-to-have', label: 'optional',
      title: `llms.txt: ${result.errors} error(s), ${result.warnings} warning(s) against the proposal's format`,
      observed: `${url} parsed with ${result.issues.length} issue(s).`,
      why: `If you publish llms.txt, it should follow the format readers expect (an H1 first, then an optional summary and link lists). ${SPECULATIVE}`,
      fix: 'Fix the lines below; `npx @bydtech/llms-txt lint <url>` shows the same issues.',
      source: SOURCES.llmstxt,
      details: capList(result.issues.map((i) => `line ${i.line}: ${i.severity} ${i.rule} — ${i.message}`)),
    });
  } else {
    ctx.pass(`${AREA}/lint`, AREA, 'llms.txt follows the proposal\'s format');
  }
  ctx.note(AREA, SPECULATIVE);
}
