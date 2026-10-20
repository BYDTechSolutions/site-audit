/**
 * Node.js helpers for `@bydtech/site-audit`. The main entry runs anywhere
 * `fetch` does; this one adds what only Node has.
 *
 * @packageDocumentation
 */
import { lookup } from 'node:dns/promises';
import type { ResolveHost } from './types.js';

/**
 * Resolves a hostname with the operating system's resolver (`node:dns`),
 * returning every address. Pass it as `resolveHost` so the private-address
 * guard also catches public names that point at private IPs.
 *
 * @example
 * ```ts
 * import { audit } from '@bydtech/site-audit';
 * import { resolveHost } from '@bydtech/site-audit/node';
 * const report = await audit('https://example.com', { resolveHost });
 * ```
 */
export const resolveHost: ResolveHost = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((r) => r.address);
};
