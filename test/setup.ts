// Tests must never reach a real site: only the local test server. A test that
// wants another hostname injects a fetch that rewrites it to 127.0.0.1.
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.hostname !== '127.0.0.1') {
    throw new Error(`Test tried to reach ${url.href}; only 127.0.0.1 is allowed.`);
  }
  return realFetch(input, init);
}) as typeof fetch;
