import { describe, expect, it } from 'vitest';
import { classifyHostname, classifyIp, isLocalDevHost, parseIPv6 } from '../src/net/ip.js';

describe('address classification', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['10.1.2.3', 'private'],
    ['172.20.0.1', 'private'],
    ['192.168.1.1', 'private'],
    ['169.254.169.254', 'link-local / cloud metadata'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['0.0.0.0', 'this network'],
    ['224.0.0.1', 'multicast'],
    ['::1', 'loopback'],
    ['::', 'unspecified'],
    ['fe80::1', 'link-local'],
    ['fd00:ec2::254', 'unique local (private)'],
    ['::ffff:127.0.0.1', 'loopback'],
    ['::ffff:7f00:1', 'loopback'],
    ['64:ff9b::a9fe:a9fe', 'link-local / cloud metadata'],
    ['2002:a00:1::', 'private'],
  ])('%s is %s', (ip, reason) => {
    expect(classifyIp(ip)).toBe(reason);
  });

  it.each(['93.184.215.14', '8.8.8.8', '172.32.0.1', '2606:4700::1111', '::ffff:8.8.8.8'])('%s is public', (ip) => {
    expect(classifyIp(ip)).toBeNull();
  });

  it('classifies reserved names and literal addresses', () => {
    expect(classifyHostname('localhost')).toBe('loopback name');
    expect(classifyHostname('app.localhost')).toBe('loopback name');
    expect(classifyHostname('metadata.google.internal')).toMatch(/internal/);
    expect(classifyHostname('printer.local')).toMatch(/multicast DNS/);
    expect(classifyHostname('intranet')).toBe('single-label name');
    expect(classifyHostname('[::1]')).toBe('loopback');
    expect(classifyHostname('example.com')).toBeNull();
  });

  it('parses IPv6 forms', () => {
    expect(parseIPv6('2001:db8::1')).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6('[::1]')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6('1:2:3')).toBeNull();
    expect(parseIPv6('1::2::3')).toBeNull();
  });

  it('knows the dev hosts the CLI allows', () => {
    expect(isLocalDevHost('localhost')).toBe(true);
    expect(isLocalDevHost('127.0.0.1')).toBe(true);
    expect(isLocalDevHost('[::1]')).toBe(true);
    expect(isLocalDevHost('10.0.0.1')).toBe(false);
  });
});
