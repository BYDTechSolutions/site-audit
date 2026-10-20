import { capList, clip, type AuditContext } from '../context.js';
import { SOURCES } from '../facts/sources.js';
import { isLocalDevHost } from '../net/ip.js';

const AREA = 'security' as const;
const ONE_YEAR = 31_536_000;

/** CSP directives by name, lowercase. Only the first occurrence of a directive counts, as in browsers. */
export function parseCsp(value: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of value.split(';')) {
    const [name, ...tokens] = part.trim().split(/\s+/);
    if (!name) continue;
    const key = name.toLowerCase();
    if (!out.has(key)) out.set(key, tokens);
  }
  return out;
}

function setCookies(headers: Headers): string[] {
  const h = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof h.getSetCookie === 'function') return h.getSetCookie();
  const raw = headers.get('set-cookie');
  return raw ? raw.split(/,(?=\s*[^;=\s]+=)/) : [];
}

/** HTTPS, HSTS, CSP, clickjacking, nosniff, Referrer-Policy, Permissions-Policy, cookies and mixed content. */
export async function checkSecurity(ctx: AuditContext): Promise<void> {
  const h = ctx.page.headers;
  const https = ctx.pageUrl.protocol === 'https:';
  const local = isLocalDevHost(ctx.pageUrl.hostname);
  // On a dev server, response headers usually come from the production host or CDN,
  // so header findings drop to nice-to-have and say so.
  const headerIds = new Set(['csp-missing', 'clickjacking', 'nosniff', 'referrer-policy', 'permissions-policy', 'version-headers', 'x-xss-protection']);
  const add = ctx.add;
  ctx = {
    ...ctx,
    add: (finding) => {
      if (local && headerIds.has(finding.id.replace(`${AREA}/`, ''))) {
        add({ ...finding, priority: 'nice-to-have', observed: `${finding.observed} (Local server: your production host or CDN may set this; check the deployed site.)` });
      } else {
        add(finding);
      }
    },
  };

  if (!https) {
    if (local) {
      ctx.note(AREA, 'Served over plain HTTP from your own machine, so HTTPS and HSTS checks are skipped. Headers your host or CDN adds in production (for example from a _headers file) are not applied by a local server either; re-check headers on the deployed site.');
    } else {
      ctx.add({
        id: `${AREA}/no-https`, area: AREA, priority: 'fix-now', label: 'measured',
        title: 'The page is served over plain HTTP',
        observed: `Final URL: ${ctx.page.url}`,
        why: 'Without HTTPS anything on the network path can read or change the page, and protections such as HSTS and Secure cookies cannot work.',
        fix: 'Serve the site over HTTPS and redirect http:// to https:// with a 301.',
        source: SOURCES.mdnHsts,
      });
    }
  }

  if (https) {
    const hsts = h.get('strict-transport-security');
    if (!hsts) {
      ctx.add({
        id: `${AREA}/hsts-missing`, area: AREA, priority: 'should-fix', label: 'measured',
        title: 'No Strict-Transport-Security (HSTS) header',
        observed: 'The HTTPS response has no Strict-Transport-Security header.',
        why: 'HSTS tells browsers to use HTTPS for this host from then on, so a visitor typing the bare domain cannot be downgraded to HTTP on the way.',
        fix: 'Send "Strict-Transport-Security: max-age=31536000; includeSubDomains" once every subdomain serves HTTPS (OWASP recommends max-age=63072000; includeSubDomains; preload).',
        source: SOURCES.owaspHeaders,
      });
    } else {
      const maxAge = Number(/max-age\s*=\s*"?(\d+)/i.exec(hsts)?.[1] ?? NaN);
      if (!Number.isFinite(maxAge) || maxAge < ONE_YEAR) {
        ctx.add({
          id: `${AREA}/hsts-short`, area: AREA, priority: 'nice-to-have', label: 'measured',
          title: maxAge === 0 ? 'HSTS is switched off (max-age=0)' : 'HSTS max-age is under one year',
          observed: `Strict-Transport-Security: ${hsts}`,
          why: 'A short max-age lets the protection lapse between visits; one year is the minimum accepted for HSTS preloading.',
          fix: 'Raise max-age to at least 31536000 (one year).',
          source: SOURCES.mdnHsts,
        });
      } else {
        ctx.pass(`${AREA}/hsts`, AREA, 'HSTS set with max-age of a year or more');
      }
    }
  }

  const cspHeader = h.get('content-security-policy');
  const cspMeta = ctx.doc.tags.find((t) => t.name === 'meta' && (t.attrs['http-equiv'] ?? '').toLowerCase() === 'content-security-policy')?.attrs.content;
  const csp = cspHeader ?? cspMeta ?? null;
  const reportOnly = h.get('content-security-policy-report-only');
  const directives = csp ? parseCsp(csp) : new Map<string, string[]>();
  if (!csp) {
    ctx.add({
      id: `${AREA}/csp-missing`, area: AREA, priority: 'should-fix', label: 'measured',
      title: reportOnly ? 'Content-Security-Policy is in report-only mode' : 'No Content-Security-Policy',
      observed: reportOnly ? `Only Content-Security-Policy-Report-Only is set: ${clip(reportOnly, 100)}` : 'No Content-Security-Policy header or meta tag.',
      why: 'A CSP limits which scripts and resources the page may load, which contains the damage of an injected script (XSS). Report-only mode reports but blocks nothing.',
      fix: 'Start with a policy that allows only your own origin and the third parties you use, run it in report-only mode, then enforce it.',
      source: SOURCES.owaspHeaders,
    });
  } else {
    const scriptSrc = directives.get('script-src') ?? directives.get('default-src') ?? [];
    const weak: string[] = [];
    const hasNonceOrHash = scriptSrc.some((t) => /^'(nonce-|sha256-|sha384-|sha512-)/i.test(t));
    if (scriptSrc.includes("'unsafe-inline'") && !hasNonceOrHash && !scriptSrc.includes("'strict-dynamic'")) weak.push("script-src allows 'unsafe-inline'");
    if (scriptSrc.includes("'unsafe-eval'")) weak.push("script-src allows 'unsafe-eval'");
    if (scriptSrc.some((t) => t === '*' || t === 'http:' || t === 'https:' || t === 'data:')) weak.push(`script-src allows any source (${scriptSrc.filter((t) => ['*', 'http:', 'https:', 'data:'].includes(t)).join(' ')})`);
    if (!directives.has('script-src') && !directives.has('default-src')) weak.push('no script-src or default-src, so scripts are not restricted');
    if (weak.length) {
      ctx.add({
        id: `${AREA}/csp-weak`, area: AREA, priority: 'nice-to-have', label: 'measured',
        title: 'The Content-Security-Policy does not restrict scripts much',
        observed: weak.join('; ') + '.',
        why: 'An injected inline script is exactly what CSP is meant to stop; these sources let it run.',
        fix: "Move inline scripts to files or allow them with nonces or hashes, drop 'unsafe-eval', and list script hosts explicitly.",
        source: SOURCES.owaspHeaders,
      });
    } else {
      ctx.pass(`${AREA}/csp`, AREA, 'Content-Security-Policy restricts scripts');
    }
  }

  // Clickjacking: frame-ancestors in a CSP header, or X-Frame-Options.
  const frameAncestors = cspHeader ? parseCsp(cspHeader).get('frame-ancestors') : undefined;
  const xfo = h.get('x-frame-options');
  if (!frameAncestors && !xfo) {
    ctx.add({
      id: `${AREA}/clickjacking`, area: AREA, priority: 'should-fix', label: 'measured',
      title: 'Any site can embed this page in a frame',
      observed: 'No frame-ancestors directive in a Content-Security-Policy header, and no X-Frame-Options header.',
      why: 'A hostile page can load yours in an invisible frame and trick visitors into clicking it (clickjacking).',
      fix: "Add frame-ancestors 'self' (or 'none') to the Content-Security-Policy header; X-Frame-Options: DENY covers older browsers.",
      source: SOURCES.owaspHeaders,
    });
  } else {
    ctx.pass(`${AREA}/clickjacking`, AREA, 'Framing is restricted');
  }

  const nosniff = (h.get('x-content-type-options') ?? '').trim().toLowerCase();
  if (nosniff !== 'nosniff') {
    ctx.add({
      id: `${AREA}/nosniff`, area: AREA, priority: 'should-fix', label: 'measured',
      title: 'X-Content-Type-Options is not "nosniff"',
      observed: nosniff ? `X-Content-Type-Options: ${nosniff}` : 'Header not set.',
      why: 'Without it, browsers may guess a response\'s type from its content (MIME sniffing) and run something as script that was not meant to be.',
      fix: 'Send "X-Content-Type-Options: nosniff" on every response, with correct Content-Type headers.',
      source: SOURCES.owaspHeaders,
    });
  } else {
    ctx.pass(`${AREA}/nosniff`, AREA, 'X-Content-Type-Options: nosniff');
  }

  const referrer = (h.get('referrer-policy') ?? '').toLowerCase();
  const referrerMeta = ctx.doc.tags.find((t) => t.name === 'meta' && (t.attrs.name ?? '').toLowerCase() === 'referrer')?.attrs.content?.toLowerCase();
  const policy = referrer || referrerMeta || '';
  if (!policy) {
    ctx.add({
      id: `${AREA}/referrer-policy`, area: AREA, priority: 'nice-to-have', label: 'measured',
      title: 'No Referrer-Policy',
      observed: 'No Referrer-Policy header or meta tag.',
      why: 'OWASP advises setting it explicitly rather than relying on browser defaults, which differ.',
      fix: 'Send "Referrer-Policy: strict-origin-when-cross-origin".',
      source: SOURCES.owaspHeaders,
    });
  } else if (policy.split(',').map((p) => p.trim()).includes('unsafe-url')) {
    ctx.add({
      id: `${AREA}/referrer-policy`, area: AREA, priority: 'should-fix', label: 'measured',
      title: 'Referrer-Policy is "unsafe-url"',
      observed: `Referrer-Policy: ${policy}`,
      why: 'unsafe-url sends the full URL, including paths and query strings, to every site you link to, even over plain HTTP.',
      fix: 'Use "strict-origin-when-cross-origin".',
      source: SOURCES.owaspHeaders,
    });
  } else {
    ctx.pass(`${AREA}/referrer-policy`, AREA, `Referrer-Policy: ${policy}`);
  }

  if (!h.get('permissions-policy')) {
    ctx.add({
      id: `${AREA}/permissions-policy`, area: AREA, priority: 'nice-to-have', label: 'measured',
      title: 'No Permissions-Policy',
      observed: 'Header not set.',
      why: 'A Permissions-Policy switches off browser features (camera, microphone, geolocation, ...) the site does not use, so an injected or embedded script cannot use them either.',
      fix: 'Send e.g. "Permissions-Policy: camera=(), microphone=(), geolocation=()", listing the features you do not need.',
      source: SOURCES.owaspHeaders,
    });
  } else {
    ctx.pass(`${AREA}/permissions-policy`, AREA, 'Permissions-Policy set');
  }

  const xxss = (h.get('x-xss-protection') ?? '').trim();
  if (xxss && !xxss.startsWith('0')) {
    ctx.add({
      id: `${AREA}/x-xss-protection`, area: AREA, priority: 'nice-to-have', label: 'measured',
      title: 'X-XSS-Protection is turned on',
      observed: `X-XSS-Protection: ${xxss}`,
      why: 'OWASP says not to set it (or to turn it off): in some cases it creates XSS holes in otherwise safe sites. CSP is the replacement.',
      fix: 'Remove the header or set it to 0.',
      source: SOURCES.owaspHeaders,
    });
  }

  const leaks = ['server', 'x-powered-by', 'x-aspnet-version']
    .map((name) => [name, h.get(name) ?? ''] as const)
    .filter(([name, value]) => value && (name !== 'server' || /\d/.test(value)));
  if (leaks.length) {
    ctx.add({
      id: `${AREA}/version-headers`, area: AREA, priority: 'nice-to-have', label: 'measured',
      title: 'Headers announce server software versions',
      observed: leaks.map(([n, v]) => `${n}: ${v}`).join('; '),
      why: 'Version numbers make it easy to match the server to known vulnerabilities. OWASP advises removing X-Powered-By and making Server non-informative.',
      fix: 'Remove X-Powered-By and strip the version from Server in your server or CDN settings.',
      source: SOURCES.owaspHeaders,
    });
  }

  const cookies = setCookies(h);
  if (cookies.length) {
    const problems: string[] = [];
    for (const raw of cookies) {
      const [pair = '', ...attrs] = raw.split(';').map((s) => s.trim());
      const name = pair.split('=')[0] ?? '';
      const flags = new Map(attrs.map((a) => {
        const [k = '', ...v] = a.split('=');
        return [k.trim().toLowerCase(), v.join('=').trim()] as const;
      }));
      const secure = flags.has('secure');
      if (https && !secure) problems.push(`${name}: missing Secure`);
      if (!flags.has('httponly')) problems.push(`${name}: missing HttpOnly (fine only if JavaScript must read it)`);
      if ((flags.get('samesite') ?? '').toLowerCase() === 'none' && !secure) problems.push(`${name}: SameSite=None without Secure is rejected`);
      if (name.startsWith('__Host-') && (!secure || flags.has('domain') || flags.get('path') !== '/')) problems.push(`${name}: __Host- cookies need Secure, Path=/ and no Domain`);
      if (name.startsWith('__Secure-') && !secure) problems.push(`${name}: __Secure- cookies need Secure`);
    }
    const serious = problems.some((p) => !p.includes('HttpOnly'));
    if (problems.length) {
      ctx.add({
        id: `${AREA}/cookies`, area: AREA, priority: serious ? 'should-fix' : 'nice-to-have', label: 'measured',
        title: `${cookies.length} cookie(s) set without the usual protections`,
        observed: `${problems.length} problem(s) in the Set-Cookie headers of this page.`,
        why: 'Secure keeps a cookie off plain HTTP; HttpOnly keeps it away from JavaScript, which limits what an XSS can steal; SameSite=None requires Secure.',
        fix: 'Set Secure on every cookie served over HTTPS, HttpOnly on session cookies, and an explicit SameSite.',
        source: SOURCES.mdnCookies,
        details: capList(problems),
      });
    } else {
      ctx.pass(`${AREA}/cookies`, AREA, `${cookies.length} cookie(s) have Secure and HttpOnly`);
    }
  }

  if (https && ctx.isHtml) {
    const blockable: string[] = [];
    const upgradable: string[] = [];
    const http = (v: string | undefined) => !!v && /^http:\/\//i.test(v.trim());
    for (const t of ctx.doc.tags) {
      const a = t.attrs;
      if (t.name === 'script' && http(a.src)) blockable.push(`<script src="${a.src}">`);
      else if (t.name === 'link' && http(a.href) && /stylesheet|preload|modulepreload|icon|manifest/i.test(a.rel ?? '')) blockable.push(`<link rel="${a.rel}" href="${a.href}">`);
      else if ((t.name === 'iframe' || t.name === 'embed') && http(a.src)) blockable.push(`<${t.name} src="${a.src}">`);
      else if (t.name === 'object' && http(a.data)) blockable.push(`<object data="${a.data}">`);
      else if ((t.name === 'img' || t.name === 'source') && a.srcset && /(^|,)\s*http:\/\//i.test(a.srcset)) blockable.push(`<${t.name} srcset="${clip(a.srcset, 60)}">`);
      else if (['img', 'audio', 'video', 'source'].includes(t.name) && http(a.src)) upgradable.push(`<${t.name} src="${a.src}">`);
    }
    if (blockable.length) {
      ctx.add({
        id: `${AREA}/mixed-content`, area: AREA, priority: 'fix-now', label: 'measured',
        title: `${blockable.length} resource(s) load over HTTP on an HTTPS page`,
        observed: 'Scripts, stylesheets, frames or srcset images use http:// URLs.',
        why: 'Browsers block this "blockable" mixed content outright, so those scripts, styles or images are missing for every visitor.',
        fix: 'Change the URLs to https:// (or relative), or add "upgrade-insecure-requests" to the CSP.',
        source: SOURCES.mdnMixed,
        details: capList(blockable),
      });
    }
    if (upgradable.length) {
      ctx.add({
        id: `${AREA}/mixed-content-upgradable`, area: AREA, priority: 'nice-to-have', label: 'measured',
        title: `${upgradable.length} image or media URL(s) use http://`,
        observed: 'img/audio/video/source src attributes use http:// URLs.',
        why: 'Browsers upgrade these to HTTPS automatically (and block them when the host is an IP address); if the host has no HTTPS, they break.',
        fix: 'Write the URLs as https:// so the page does not depend on the upgrade.',
        source: SOURCES.mdnMixed,
        details: capList(upgradable),
      });
    }
    if (!blockable.length && !upgradable.length) ctx.pass(`${AREA}/mixed-content`, AREA, 'No mixed content in the HTML');
  }
}
