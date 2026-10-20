import { describe, expect, it } from 'vitest';
import { decodeEntities, linksWithRel, metaContent, parsePage } from '../src/html.js';

describe('parsePage', () => {
  it('reads tags, attributes, head membership, titles and scripts', () => {
    const doc = parsePage(`<!doctype html><html lang="en-US"><head>
      <!-- <title>commented</title> -->
      <title>Caf&eacute; &amp; Bar &#8212; Home</title>
      <meta name="description" content='Single "quoted"'>
      <meta property="og:title" content=unquoted>
      <link rel="canonical stylesheet" href="/x">
      <script type="application/ld+json">{"@type":"Thing","a":"</div>"}</script>
      </head><body><link rel="canonical" href="/late"><a href="/a?x=1&amp;y=2">A</a><img src=hero.png alt></body></html>`);
    expect(doc.lang).toBe('en-US');
    expect(doc.titles).toEqual([{ text: 'Caf&eacute; & Bar — Home', inHead: true }]);
    expect(metaContent(doc, 'description')).toBe('Single "quoted"');
    expect(metaContent(doc, 'OG:TITLE')).toBe('unquoted');
    const canon = linksWithRel(doc, 'canonical');
    expect(canon.map((t) => [t.attrs.href, t.inHead])).toEqual([['/x', true], ['/late', false]]);
    expect(doc.scripts[0]?.text).toBe('{"@type":"Thing","a":"</div>"}');
    expect(doc.tags.find((t) => t.name === 'a')?.attrs.href).toBe('/a?x=1&y=2');
    expect(doc.tags.find((t) => t.name === 'img')?.attrs).toEqual({ src: 'hero.png', alt: '' });
  });

  it('leaves the head when body content starts without a <body> tag', () => {
    const doc = parsePage('<title>t</title><div>x</div><link rel="canonical" href="/c">');
    expect(linksWithRel(doc, 'canonical')[0]?.inHead).toBe(false);
  });

  it('survives broken markup', () => {
    expect(() => parsePage('<div class="x><p>unclosed <script>no end')).not.toThrow();
    expect(parsePage('< not a tag <3').tags).toEqual([]);
  });

  it('decodes entities', () => {
    expect(decodeEntities('&lt;a&gt; &#x41;&#66; &copy; &unknown;')).toBe('<a> AB © &unknown;');
  });
});
