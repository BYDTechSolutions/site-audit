import { readFileSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PSI_ENDPOINT } from '../src/checks/psi.js';

export interface Recorded {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
}

export interface Reply {
  status?: number;
  headers?: Record<string, string | string[]>;
  body?: string | Uint8Array;
  delayMs?: number;
}

export type Handler = (req: Recorded) => Reply | undefined;

export interface TestServer {
  origin: string;
  port: number;
  requests: Recorded[];
  routes: Map<string, Reply | Handler>;
  maxInFlight: () => number;
  close: () => Promise<void>;
}

export const html = (body: string, head = '', headers: Record<string, string | string[]> = {}): Reply => ({
  headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
  body: `<!doctype html><html lang="en"><head>${head}</head><body>${body}</body></html>`,
});

export const text = (body: string, type = 'text/plain; charset=utf-8'): Reply => ({ headers: { 'content-type': type }, body });

export const redirect = (location: string, status = 301): Reply => ({ status, headers: { location } });

/** A minimal PNG header (signature + IHDR) with the given size; enough for size sniffing. */
export function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(b.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  b[24] = 8;
  b[25] = 6;
  return b;
}

/** A local server standing in for a whole site. */
export async function startServer(routes: Record<string, Reply | Handler> = {}): Promise<TestServer> {
  const map = new Map<string, Reply | Handler>(Object.entries(routes));
  const requests: Recorded[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const server: Server = createServer((req, res) => {
    const recorded: Recorded = { method: req.method ?? 'GET', path: req.url ?? '/', headers: req.headers };
    requests.push(recorded);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const route = map.get(recorded.path) ?? map.get(recorded.path.split('?')[0] as string);
    const reply = typeof route === 'function' ? route(recorded) : route;
    const send = () => {
      inFlight -= 1;
      if (!reply) {
        res.writeHead(404, { 'content-type': 'text/html' }).end('<h1>Not found</h1>');
        return;
      }
      res.writeHead(reply.status ?? 200, reply.headers ?? {});
      res.end(recorded.method === 'HEAD' ? undefined : (reply.body ?? ''));
    };
    if (reply?.delayMs) setTimeout(send, reply.delayMs);
    else send();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    port,
    requests,
    routes: map,
    maxInFlight: () => maxInFlight,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** Reads a JSON fixture. */
export function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

/**
 * A fetch that serves `https://site.test` (and `http://site.test`) from the
 * local server, and answers PageSpeed Insights calls with `psi`. Lets tests
 * exercise the private-address guard with a "public" hostname.
 */
export function siteFetch(server: TestServer, psi?: (url: URL) => Response): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.href.startsWith(PSI_ENDPOINT)) {
      if (!psi) throw new Error('unexpected PSI call');
      return psi(url);
    }
    if (url.hostname === 'site.test') {
      const local = new URL(url.pathname + url.search, server.origin);
      const res = await globalThis.fetch(local, init);
      // Rewrite absolute Location headers that point back at the local server.
      const location = res.headers.get('location');
      if (location?.startsWith(server.origin)) {
        const headers = new Headers(res.headers);
        headers.set('location', location.replace(server.origin, `${url.protocol}//site.test`));
        return new Response(res.body, { status: res.status, headers });
      }
      return res;
    }
    return globalThis.fetch(input, init);
  }) as typeof fetch;
}

/** A resolver that says every name is a public address, except the ones mapped. */
export function fakeResolver(map: Record<string, string[]> = {}) {
  return async (hostname: string) => map[hostname] ?? ['93.184.215.14'];
}

export const json = (body: unknown, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
