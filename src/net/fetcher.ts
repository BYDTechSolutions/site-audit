/*
 * Every request the engine makes goes through `safeFetch`: http(s) only, the
 * private-address guard on the first URL and on every redirect, a redirect
 * cap, a body cap and a timeout. Web-standard fetch only, so it runs in Node
 * and in Workers alike.
 */
import { SiteAuditError } from '../errors.js';
import type { Hop, ResolveHost } from '../types.js';
import { USER_AGENT } from '../version.js';
import { classifyHostname, classifyIp, isIpLiteral } from './ip.js';

/** Settings shared by every request in one audit. */
export interface FetchContext {
  fetch: typeof fetch;
  allowPrivate: boolean;
  resolveHost?: ResolveHost;
  maxRedirects: number;
  maxBodyBytes: number;
  timeoutMs: number;
  /** Per-run cache of DNS answers, so one host is resolved once. */
  dns: Map<string, Promise<string[]>>;
}

/** Options for one request. */
export interface RequestOptions {
  method?: 'GET' | 'HEAD';
  userAgent?: string;
  accept?: string;
  /** Read at most this many bytes (defaults to the context's cap). */
  maxBytes?: number;
  timeoutMs?: number;
  /** Do not follow redirects; return the 3xx itself. */
  noFollow?: boolean;
}

/** A response, read (up to the cap). */
export interface Fetched {
  url: string;
  status: number;
  headers: Headers;
  contentType: string;
  body: Uint8Array;
  truncated: boolean;
  redirects: Hop[];
  timeMs: number;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** Builds a context with the engine's defaults filled in. */
export function createContext(init: Partial<FetchContext> = {}): FetchContext {
  return {
    fetch: init.fetch ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args)),
    allowPrivate: init.allowPrivate ?? false,
    resolveHost: init.resolveHost,
    maxRedirects: init.maxRedirects ?? 10,
    maxBodyBytes: init.maxBodyBytes ?? 5_000_000,
    timeoutMs: init.timeoutMs ?? 15_000,
    dns: init.dns ?? new Map(),
  };
}

/** Parses and checks a URL: absolute, http(s), no credentials. Throws `INVALID_URL`. */
export function parseTarget(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new SiteAuditError('INVALID_URL', `Not a valid URL: ${input}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SiteAuditError('INVALID_URL', `Only http and https URLs can be audited, not ${url.protocol.replace(':', '')}: ${input}`);
  }
  if (url.username || url.password) {
    throw new SiteAuditError('INVALID_URL', 'URLs with a username or password are not accepted.');
  }
  return url;
}

/**
 * Throws `BLOCKED` when the URL points at a private, loopback, link-local or
 * metadata address and private targets are not allowed. With `resolveHost`,
 * hostnames are resolved and every address is checked.
 */
export async function assertAllowed(url: URL, ctx: FetchContext): Promise<void> {
  parseTarget(url.href);
  if (ctx.allowPrivate) return;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const reason = classifyHostname(host);
  if (reason) {
    throw new SiteAuditError('BLOCKED', `Refusing to fetch ${url.href}: ${host} is a ${reason} address. Private targets are only allowed when you audit your own machine.`);
  }
  if (!ctx.resolveHost || isIpLiteral(host)) return;
  let pending = ctx.dns.get(host);
  if (!pending) {
    pending = ctx.resolveHost(host);
    ctx.dns.set(host, pending);
  }
  let addresses: string[];
  try {
    addresses = await pending;
  } catch (error) {
    throw new SiteAuditError('FETCH', `Could not resolve ${host}: ${(error as Error).message}`);
  }
  for (const address of addresses) {
    const why = classifyIp(address);
    if (why) {
      throw new SiteAuditError('BLOCKED', `Refusing to fetch ${url.href}: ${host} resolves to ${address}, a ${why} address.`);
    }
  }
}

async function readCapped(response: Response, maxBytes: number): Promise<{ body: Uint8Array; truncated: boolean }> {
  if (!response.body) return { body: new Uint8Array(0), truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - size));
      size = maxBytes;
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
    size += value.byteLength;
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { body, truncated };
}

/**
 * Fetches a URL safely: checks the guard before the first request and before
 * every redirect, follows at most `maxRedirects`, reads at most `maxBytes`.
 * Network failures throw `FETCH`; a guard hit throws `BLOCKED`.
 */
export async function safeFetch(ctx: FetchContext, input: string, options: RequestOptions = {}): Promise<Fetched> {
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? ctx.timeoutMs;
  const signal = AbortSignal.timeout(timeoutMs);
  const method = options.method ?? 'GET';
  const redirects: Hop[] = [];
  let url = parseTarget(input);
  for (;;) {
    await assertAllowed(url, ctx);
    let response: Response;
    try {
      response = await ctx.fetch(url.href, {
        method,
        redirect: 'manual',
        headers: {
          'User-Agent': options.userAgent ?? USER_AGENT,
          Accept: options.accept ?? '*/*',
        },
        signal,
      });
    } catch (error) {
      const err = error as Error & { cause?: { code?: string; message?: string } };
      const reason = err.name === 'TimeoutError' || err.name === 'AbortError'
        ? `timed out after ${timeoutMs} ms`
        : err.cause?.code ?? err.cause?.message ?? err.message;
      throw new SiteAuditError('FETCH', `Could not fetch ${url.href}: ${reason}`);
    }
    const location = response.headers.get('location');
    if (REDIRECTS.has(response.status) && location && !options.noFollow) {
      await response.body?.cancel().catch(() => undefined);
      redirects.push({ url: url.href, status: response.status });
      if (redirects.length > ctx.maxRedirects) {
        throw new SiteAuditError('FETCH', `Too many redirects (more than ${ctx.maxRedirects}) starting at ${input}`);
      }
      try {
        url = parseTarget(new URL(location, url).href);
      } catch (error) {
        if (error instanceof SiteAuditError) {
          throw new SiteAuditError(error.code, `Redirect from ${url.href} goes to an unsupported location: ${location}`);
        }
        throw error;
      }
      continue;
    }
    let read: { body: Uint8Array; truncated: boolean };
    try {
      read = method === 'HEAD'
        ? (await response.body?.cancel().catch(() => undefined), { body: new Uint8Array(0), truncated: false })
        : await readCapped(response, options.maxBytes ?? ctx.maxBodyBytes);
    } catch (error) {
      const err = error as Error;
      const reason = err.name === 'TimeoutError' || err.name === 'AbortError' ? `timed out after ${timeoutMs} ms` : err.message;
      throw new SiteAuditError('FETCH', `Could not read ${url.href}: ${reason}`);
    }
    return {
      url: url.href,
      status: response.status,
      headers: response.headers,
      contentType: (response.headers.get('content-type') ?? '').toLowerCase(),
      body: read.body,
      truncated: read.truncated,
      redirects,
      timeMs: Date.now() - started,
    };
  }
}

/** Decodes a body as text, honoring the charset in the content type when the runtime knows it. */
export function decodeText(body: Uint8Array, contentType = ''): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ?? 'utf-8';
  try {
    return new TextDecoder(charset).decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}

/** Runs `task` over `items` with at most `limit` at once; results keep input order. */
export async function mapLimit<T, R>(items: T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await task(items[i] as T, i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

/** Resolves after `ms` milliseconds. */
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
