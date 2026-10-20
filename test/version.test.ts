import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { USER_AGENT, VERSION } from '../src/version.js';

describe('version', () => {
  it('matches package.json and names the repo in the User-Agent', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(VERSION).toBe(pkg.version);
    expect(USER_AGENT).toBe(`site-audit/${pkg.version} (+https://github.com/BYDTechSolutions/site-audit)`);
  });
});
