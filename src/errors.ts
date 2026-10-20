/**
 * Why an audit could not run at all. Problems found on the site are findings,
 * not errors; these are for when there is no site to look at.
 *
 * - `INVALID_URL`: not an absolute http(s) URL.
 * - `BLOCKED`: the target (or a redirect) points at a private, loopback, link-local or metadata address and `allowPrivate` is off.
 * - `FETCH`: the page could not be fetched (DNS, connection, TLS, timeout, too many redirects).
 */
export type SiteAuditErrorCode = 'INVALID_URL' | 'BLOCKED' | 'FETCH';

/** Thrown by `audit` when the audited page itself cannot be fetched. */
export class SiteAuditError extends Error {
  readonly code: SiteAuditErrorCode;

  constructor(code: SiteAuditErrorCode, message: string) {
    super(message);
    this.name = 'SiteAuditError';
    this.code = code;
  }
}
