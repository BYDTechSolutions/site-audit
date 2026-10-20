// Run: node examples/audit.mjs https://example.com
// Prints the "Fix now" and "Should fix" items, and writes report.html.
import { writeFile } from 'node:fs/promises';
import { audit, formatReport } from '@bydtech/site-audit';
import { resolveHost } from '@bydtech/site-audit/node';

const url = process.argv[2] ?? 'https://example.com';
const report = await audit(url, {
  psiKey: process.env.PSI_API_KEY, // optional; without it speed and accessibility may be skipped
  resolveHost,
  onProgress: (message) => process.stderr.write(`${message}\n`),
});

for (const f of report.findings.filter((f) => f.priority !== 'nice-to-have')) {
  console.log(`[${f.priority}] ${f.title}\n  fix: ${f.fix}\n  source: ${f.source.url}`);
}
await writeFile('report.html', formatReport(report, 'html'));
console.log(`\n${report.findings.length} findings, ${report.passed.length} passed. Wrote report.html`);
