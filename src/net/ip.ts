/*
 * Address classification for the SSRF guard: which hosts an audit may not
 * reach unless `allowPrivate` is on. Pure functions, no Node APIs.
 */

type Cidr4 = [number, number]; // [network as uint32, prefix length]

const V4_BLOCKED: [string, number, string][] = [
  ['0.0.0.0', 8, 'this network'],
  ['10.0.0.0', 8, 'private'],
  ['100.64.0.0', 10, 'carrier-grade NAT'],
  ['127.0.0.0', 8, 'loopback'],
  ['169.254.0.0', 16, 'link-local / cloud metadata'],
  ['172.16.0.0', 12, 'private'],
  ['192.0.0.0', 24, 'IETF protocol assignments'],
  ['192.0.2.0', 24, 'documentation'],
  ['192.168.0.0', 16, 'private'],
  ['198.18.0.0', 15, 'benchmarking'],
  ['198.51.100.0', 24, 'documentation'],
  ['203.0.113.0', 24, 'documentation'],
  ['224.0.0.0', 4, 'multicast'],
  ['240.0.0.0', 4, 'reserved'],
];

/** Parses dotted-quad IPv4 into a uint32, or `null`. */
export function parseIPv4(text: string): number | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

const V4_RANGES: Cidr4[] = V4_BLOCKED.map(([ip, bits]) => [parseIPv4(ip) as number, bits]);

function inV4(value: number, [net, bits]: Cidr4): boolean {
  if (bits === 0) return true;
  const size = 2 ** (32 - bits);
  return Math.floor(value / size) === Math.floor(net / size);
}

/** Why an IPv4 address is not public, or `null` when it is public. */
export function classifyIPv4(text: string): string | null {
  const value = parseIPv4(text);
  if (value === null) return null;
  for (let i = 0; i < V4_RANGES.length; i++) {
    if (inV4(value, V4_RANGES[i] as Cidr4)) return (V4_BLOCKED[i] as [string, number, string])[2];
  }
  return null;
}

/** Parses an IPv6 address (with optional embedded IPv4) into 8 16-bit groups, or `null`. */
export function parseIPv6(input: string): number[] | null {
  let text = input.replace(/^\[|\]$/g, '');
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);
  if (!text.includes(':')) return null;
  let tail: number[] = [];
  const lastColon = text.lastIndexOf(':');
  const last = text.slice(lastColon + 1);
  if (last.includes('.')) {
    const v4 = parseIPv4(last);
    if (v4 === null) return null;
    tail = [Math.floor(v4 / 65536), v4 % 65536];
    text = text.slice(0, lastColon + 1) + '0:0';
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parse = (s: string) => (s === '' ? [] : s.split(':'));
  const head = parse(halves[0] as string);
  const rest = halves.length === 2 ? parse(halves[1] as string) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (halves.length === 2 && missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...rest];
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  if (out.length !== 8) return null;
  if (tail.length) {
    out[6] = tail[0] as number;
    out[7] = tail[1] as number;
  }
  return out;
}

function v4FromGroups(hi: number, lo: number): string {
  return [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.');
}

/** Why an IPv6 address is not public, or `null` when it is public. */
export function classifyIPv6(text: string): string | null {
  const g = parseIPv6(text);
  if (!g) return null;
  const [a, b, c, d, e, f, g6, h] = g as [number, number, number, number, number, number, number, number];
  const zeroTo = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zeroTo(8)) return 'unspecified';
  if (zeroTo(7) && h === 1) return 'loopback';
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d): judge the IPv4 address.
  if (zeroTo(5) && f === 0xffff) return classifyIPv4(v4FromGroups(g6, h)) ?? null;
  if (zeroTo(6)) return classifyIPv4(v4FromGroups(g6, h)) ?? 'IPv4-compatible';
  // NAT64 (64:ff9b::/96) and 6to4 (2002::/16) embed an IPv4 address.
  if (a === 0x64 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0) return classifyIPv4(v4FromGroups(g6, h));
  if (a === 0x2002) return classifyIPv4(v4FromGroups(b, c));
  if (a === 0x0100 && b === 0 && c === 0 && d === 0) return 'discard-only';
  if (a === 0x2001 && b === 0x0db8) return 'documentation';
  if ((a & 0xfe00) === 0xfc00) return 'unique local (private)';
  if ((a & 0xffc0) === 0xfe80) return 'link-local';
  if ((a & 0xffc0) === 0xfec0) return 'site-local';
  if ((a & 0xff00) === 0xff00) return 'multicast';
  return null;
}

/** Why an IP address (v4 or v6) is not public, or `null` when it is public or not an IP. */
export function classifyIp(text: string): string | null {
  return text.includes(':') || text.startsWith('[') ? classifyIPv6(text) : classifyIPv4(text);
}

/** True when the text is an IP literal (v4, or v6 with or without brackets). */
export function isIpLiteral(text: string): boolean {
  return parseIPv4(text) !== null || parseIPv6(text) !== null;
}

/** Why a hostname is reserved for local or internal use, or `null`. Covers names, not resolved addresses. */
export function classifyHostname(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return 'loopback name';
  if (host.endsWith('.local')) return 'multicast DNS name';
  if (host.endsWith('.internal') || host === 'internal') return 'internal name (cloud metadata and private services)';
  if (host.endsWith('.home.arpa')) return 'home network name';
  if (!host.includes('.') && !isIpLiteral(host)) return 'single-label name';
  return classifyIp(host);
}

/** True for the hosts the CLI treats as "your own machine": `localhost`, `127.0.0.1` and `::1`. */
export function isLocalDevHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}
