import type { Report } from '../types.js';
import { formatHtml } from './html.js';
import { formatMarkdown } from './markdown.js';
import { formatText, type TextOptions } from './text.js';

/** Output formats. `text` is for terminals; `html` is one self-contained file. */
export type ReportFormat = 'text' | 'json' | 'md' | 'html';

/** Every format, for validation. */
export const FORMATS: readonly ReportFormat[] = ['text', 'json', 'md', 'html'];

/** Renders a report in the given format. */
export function formatReport(report: Report, format: ReportFormat = 'text', options: TextOptions = {}): string {
  switch (format) {
    case 'json':
      return `${JSON.stringify(report, null, 2)}\n`;
    case 'md':
      return formatMarkdown(report);
    case 'html':
      return formatHtml(report);
    default:
      return formatText(report, options);
  }
}

export { formatHtml, formatMarkdown, formatText, type TextOptions };
