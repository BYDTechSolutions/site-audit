import { html, png, redirect, text, type Handler, type Reply } from './helpers.js';

const SECURE_HEADERS = {
  'content-security-policy': "default-src 'self'; frame-ancestors 'self'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=()',
};

/** A site that does things right. `base` is the origin the pages should name. */
export function goodSite(base: string): Record<string, Reply | Handler> {
  const jsonld = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', '@id': '#org', name: 'Example Co', url: `${base}/` },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${base}/` },
          { '@type': 'ListItem', position: 2, name: 'About' },
        ],
      },
      { '@type': 'Product', name: 'Widget', offers: { '@type': 'Offer', price: '10.00', priceCurrency: 'USD' } },
    ],
  });
  return {
    '/': html(
      `<h1>Example</h1><a href="/about">About</a> <a href="/contact#form">Contact</a> <a href="mailto:hi@example.test">Mail</a> <a href="#top">Top</a>
       <script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC1234567"></script>
       <script>window.dataLayer=[];function gtag(){dataLayer.push(arguments)}gtag('config', 'G-ABC1234567');</script>`,
      `<meta charset="utf-8"><title>Example Co — Widgets for small teams</title>
       <meta name="description" content="Example Co makes widgets for small teams.">
       <link rel="canonical" href="${base}/">
       <link rel="alternate" hreflang="en" href="${base}/"><link rel="alternate" hreflang="x-default" href="${base}/">
       <meta property="og:title" content="Example Co"><meta property="og:type" content="website">
       <meta property="og:url" content="${base}/"><meta property="og:image" content="${base}/og.png">
       <meta property="og:image:alt" content="The Example Co logo"><meta property="og:description" content="Widgets.">
       <script type="application/ld+json">${jsonld}</script>`,
      SECURE_HEADERS,
    ),
    '/about': html('<p>About</p>', '<title>About</title>'),
    '/contact': html('<p>Contact</p>', '<title>Contact</title>'),
    '/og.png': { headers: { 'content-type': 'image/png' }, body: png(1200, 630) },
    '/robots.txt': text(`User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`),
    '/sitemap.xml': text(
      `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${base}/</loc><lastmod>2026-10-01</lastmod></url><url><loc>${base}/about</loc><lastmod>2026-09-12</lastmod></url></urlset>`,
      'application/xml',
    ),
    '/llms.txt': text('# Example Co\n\n> Widgets for small teams.\n\n## Docs\n\n- [About](/about): who we are\n', 'text/markdown; charset=utf-8'),
  };
}

/** A site with something wrong in every area. */
export function brokenSite(): Record<string, Reply | Handler> {
  const home = html(
    `<p>Hi</p>
     <a href="/ok">ok</a> <a href="/missing">missing</a> <a href="/gone">gone</a> <a href="/server-error">down</a> <a href="/forbidden">members</a>
     <img src="/hero.jpg">
     <script>!function(f,b,e,v,n,t,s){}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init', '123456789012345');</script>
     <script src="https://static.hotjar.com/c/hotjar-1.js?sv=6"></script>
     <script src="https://consent.cookiebot.com/uc.js"></script>`,
    `<meta name="robots" content="noindex, nofollow">
     <link rel="canonical" href="/one"><link rel="canonical" href="/two">
     <link rel="alternate" hreflang="english" href="/en">
     <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Broken",}</script>
     <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Thing"}</script>
     <script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[]}</script>
     <script type="application/ld+json">{"@context":"https://schema.org","@type":"Event","name":"Launch","startDate":"2026-11-01","location":{"@type":"Place","name":"Hall"}}</script>`,
    { 'x-powered-by': 'Express 4.18.2', 'set-cookie': ['sid=abc; Path=/', 'pref=1; SameSite=None'] },
  );
  return {
    '/': (req) => {
      const ua = String(req.headers['user-agent'] ?? '');
      if (ua.includes('PerplexityBot')) return { status: 403, headers: { 'content-type': 'text/html' }, body: '<title>Forbidden</title>Access denied' };
      if (ua.includes('ClaudeBot')) return { status: 403, headers: { 'content-type': 'text/html', 'cf-mitigated': 'challenge' }, body: '<title>Just a moment</title>' };
      if (ua.includes('OAI-SearchBot')) return { headers: { 'content-type': 'text/html' }, body: '<title>Blocked</title>' };
      return home;
    },
    '/start': redirect('/hop', 302),
    '/hop': redirect('/', 301),
    '/ok': html('<p>ok</p>'),
    '/gone': { status: 410, body: 'gone' },
    '/server-error': { status: 500, body: 'oops' },
    '/forbidden': { status: 403, body: 'no' },
    '/robots.txt': text('Disallow: /orphan\nUser-agent: GPTBot\nDisallow: /\n\nUser-agent: ChatGPT-User\nUser-agent: PerplexityBot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin\nCrawl-delay: 10\nSitemap: /missing-sitemap.xml\n'),
    '/llms.txt': html('<div id="app"></div>'),
  };
}
