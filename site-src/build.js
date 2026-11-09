#!/usr/bin/env node
// Builds the website's document pages from Markdown, so the policy the apps link to and the site never drift apart:
//   PRIVACY.md → site/privacy.html, TERMS.md → site/terms.html, site-src/pages/*.md → site/<name>.html
// Run `node site-src/build.js` after editing any of them and commit the output (the server serves site/ as static files).
// No dependencies: a small Markdown subset (headings, paragraphs, lists, bold, italic, code, links, bare URLs).
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), SITE = path.join(ROOT, 'site'), SRC = __dirname;
const PAGES = [
  { src: path.join(ROOT, 'PRIVACY.md'), out: 'privacy.html', title: 'Privacy Policy' },
  { src: path.join(ROOT, 'TERMS.md'), out: 'terms.html', title: 'Terms of Service' },
  ...fs.readdirSync(path.join(SRC, 'pages')).filter(f => f.endsWith('.md')).sort()
    .map(f => ({ src: path.join(SRC, 'pages', f), out: f.replace(/\.md$/, '.html') })),
];

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function inline(s) {
  const keep = [];
  const hold = h => `\u0000${keep.push(h) - 1}\u0000`;
  s = s.replace(/`([^`]+)`/g, (_, c) => hold(`<code>${esc(c)}</code>`));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => hold(`<a href="${esc(u.replace(/^https:\/\/mitosisgame\.com(?=\/)/, ''))}">${inline(t)}</a>`));
  s = esc(s);
  s = s.replace(/https?:\/\/[^\s<)]+[^\s<).,;:]/g, u => hold(`<a href="${u}">${u}</a>`));
  s = s.replace(/[\w.+-]+@[\w-]+\.[\w.]+[a-z]/gi, m => hold(`<a href="mailto:${m}">${m}</a>`));
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(])_([^_]+)_(?=[\s).,;:]|$)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[+i]);
}
function markdown(md) {
  const out = [], lines = md.replace(/\r/g, '').split('\n');
  let para = [], list = null, title = '', updated = '';
  const flush = () => {
    if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; }
    if (list) { out.push(`<${list.tag}>${list.items.map(i => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { flush(); continue; }
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      flush();
      if (m[1] === '#' && !title) { title = m[2]; continue; }
      const id = m[2].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      out.push(`<h${m[1].length} id="${id}">${inline(m[2])}</h${m[1].length}>`);
    } else if ((m = line.match(/^_(Last updated:[^_]+)_$/))) { flush(); updated = m[1]; }
    else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) { if (para.length || (list && list.tag !== 'ul')) flush(); list = list || { tag: 'ul', items: [] }; list.items.push(m[1]); }
    else if ((m = line.match(/^\s*\d+\.\s+(.*)$/))) { if (para.length || (list && list.tag !== 'ol')) flush(); list = list || { tag: 'ol', items: [] }; list.items.push(m[1]); }
    else if (list && /^\s{2,}\S/.test(line)) list.items[list.items.length - 1] += ' ' + line.trim();
    else { if (list) flush(); para.push(line.trim()); }
  }
  flush();
  return { title, updated, body: out.join('\n') };
}
const page = ({ title, heading, updated, body, out }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)} — Mitosis: Cell Arena</title>
<meta name="theme-color" content="#020809">
<link rel="canonical" href="https://mitosisgame.com/${out.replace(/\.html$/, '')}">
<link rel="icon" href="/assets/icon-192.png" type="image/png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,800&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<link rel="stylesheet" href="/assets/site.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top">
  <div class="wrap">
    <a class="brand" href="/"><img src="/assets/icon-192.png" alt="" width="34" height="34"><span>Mitosis <small>Cell Arena</small></span></a>
    <nav class="nav" aria-label="Main"><a href="/support">Support</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a class="cta" href="/play">Play now</a></nav>
  </div>
</header>
<main id="main" class="doc">
  <div class="wrap">
    <h1>${inline(heading)}</h1>
    ${updated ? `<p class="updated">${esc(updated)}</p>` : '<p class="updated"></p>'}
${body}
  </div>
</main>
<footer>
  <div class="wrap">
    <a class="brand" href="/"><img src="/assets/icon-192.png" alt="" width="34" height="34"><span>Mitosis</span></a>
    <nav aria-label="Footer"><a href="/play">Play</a><a href="/support">Support</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/delete-account">Delete account</a></nav>
    <span class="copy">© 2026 Catapult Consulting, LLC</span>
  </div>
</footer>
</body>
</html>
`;

for (const p of PAGES) {
  const md = markdown(fs.readFileSync(p.src, 'utf8'));
  const heading = (md.title || p.title || '').replace(/^Mitosis: Cell Arena\s+—\s+/, '');
  fs.writeFileSync(path.join(SITE, p.out), page({ title: p.title || heading, heading, updated: md.updated, body: md.body, out: p.out }));
  console.log('wrote site/' + p.out);
}
