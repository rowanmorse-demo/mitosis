"""Name fonts: builds the fonts players can pick for their name (fonts/fonts.json) into index.html.

Each font comes from Google Fonts' repository (github.com/google/fonts, SIL OFL 1.1 or Apache 2.0, both fine to
bundle in a paid app). The tool downloads the source and its licence, pins a variable font to one style, subsets
it to the letters a name can use (Basic Latin letters, digits, the name punctuation and Latin-1 letters; anything
else falls back to the game's font letter by letter), renames it MitosisName<id> (a modified OFL font may not keep
a Reserved Font Name; the game shows its own labels) and keeps its copyright and licence fields. Then it writes:
  - index.html: the @font-face block (<style id="nameFonts">) and the catalogue (NAME_FONTS, NF_CREDITS) between
    the @name-fonts markers,
  - fonts/licenses/<dir>.txt (each font's licence, as published) and fonts/CREDITS.md.
Ids are kept for good: they travel in play and live on the server. Add new fonts with new ids; never reuse one.

Needs fontTools and brotli. /usr/bin/python3 is the Xcode shim (it hangs while xcodebuild runs), so use a venv:
  /opt/homebrew/bin/python3 -m venv /tmp/fv && /tmp/fv/bin/pip install fonttools brotli
  /tmp/fv/bin/python -I tools/name-fonts.py --cache ~/.cache/mitosis-fonts
"""
import argparse, base64, io, json, os, re, sys, time, urllib.request

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = 'https://raw.githubusercontent.com/google/fonts/main'
CHARS = set(" !'()-.?_…") | {chr(c) for r in ((48, 58), (65, 91), (97, 123)) for c in range(*r)}
CHARS |= {chr(c) for c in range(0xC0, 0x100) if c not in (0xD7, 0xF7)}
RANGE = 'U+20-7E,U+C0-FF,U+2026'
NEED = set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .-_'!?")
REF, REF_W, REF_CAP = 'Unnamed cell', 6.6, 0.72   # names are scaled so this reads about as wide and tall in every font


def fetch(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return dest
    for i in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'mitosis-name-fonts'}), timeout=120) as r:
                data = r.read()
            tmp = dest + '.part'
            open(tmp, 'wb').write(data)
            os.replace(tmp, dest)
            return dest
        except Exception as e:  # ship Wi-Fi: try again
            print('  retry', url, e)
            time.sleep(2 + i * 3)
    sys.exit('could not download ' + url)


def build(f, src):
    font = TTFont(src)
    for t in font.keys():  # a truncated download fails here, not later
        font[t]
    if 'fvar' in font:
        spec = {a.axisTag: a.defaultValue for a in font['fvar'].axes}
        spec.update(f.get('instance') or {})
        font = instancer.instantiateVariableFont(font, spec)
    cmap, upm = font.getBestCmap(), font['head'].unitsPerEm
    missing = ''.join(sorted(c for c in NEED if ord(c) not in cmap))
    if missing:
        print(f"  {f['label']}: no {missing!r} (the game's font fills in)")
    width = sum(font['hmtx'][cmap[ord(c)]][0] if ord(c) in cmap else upm / 2 for c in REF) / upm
    cap = (getattr(font['OS/2'], 'sCapHeight', 0) or 0.7 * upm) / upm
    size = round(min(1.25, max(0.6, min(REF_W / width, REF_CAP / cap))), 2)
    copyright = font['name'].getDebugName(0) or ''
    o = subset.Options()
    o.flavor, o.hinting, o.desubroutinize, o.notdef_outline, o.glyph_names = 'woff2', False, True, False, False
    o.layout_features = ['kern', 'liga', 'calt', 'clig', 'ccmp', 'locl', 'mark', 'mkmk']
    o.name_IDs, o.name_languages, o.legacy_kern = [0, 13, 14], [0x409], True
    s = subset.Subsetter(o)
    s.populate(unicodes=[ord(c) for c in CHARS if ord(c) in cmap])
    s.subset(font)
    name, fam = font['name'], f"MitosisName{f['id']}"
    for nid, v in ((1, fam), (2, 'Regular'), (3, fam + '-subset'), (4, fam), (6, fam)):
        name.setName(v, nid, 3, 1, 0x409)
    name.names = [n for n in name.names if n.platformID == 3]
    buf = io.BytesIO()
    font.flavor = 'woff2'
    font.save(buf)
    return buf.getvalue(), size, round(cap * size, 3), copyright


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', required=True, help='where the downloaded sources are kept')
    a = ap.parse_args()
    os.makedirs(a.cache, exist_ok=True)
    fonts = json.load(open(os.path.join(ROOT, 'fonts/fonts.json')))
    ids = [f['id'] for f in fonts]
    assert len(ids) == len(set(ids)) and all(0 < i < 256 for i in ids), 'ids must be unique, 1-255'
    lic_dir = os.path.join(ROOT, 'fonts/licenses')
    os.makedirs(lic_dir, exist_ok=True)
    faces, cat, credits, total, texts = [], [], [], 0, {}
    for f in fonts:
        kind = 'apache' if f['licence'] == 'Apache-2.0' else 'ofl'
        src = fetch(f"{RAW}/{kind}/{f['dir']}/{f['file']}".replace('[', '%5B').replace(']', '%5D').replace(',', '%2C'), os.path.join(a.cache, f['file']))
        lic = fetch(f"{RAW}/{kind}/{f['dir']}/{'LICENSE.txt' if kind == 'apache' else 'OFL.txt'}", os.path.join(a.cache, f['dir'] + '.licence.txt'))
        text = open(lic, encoding='utf-8').read()
        assert ('OTHER DEALINGS IN THE FONT SOFTWARE' in text) if kind == 'ofl' else ('END OF TERMS AND CONDITIONS' in text), 'incomplete licence: ' + lic
        open(os.path.join(lic_dir, f['dir'] + '.txt'), 'w', encoding='utf-8').write(text)
        if kind == 'ofl':  # the licence itself, once per kind, for the in-game credits (each font's copyright is listed there)
            texts.setdefault('ofl', 'This Font Software is licensed' + text.split('This Font Software is licensed', 1)[1])
        else:
            texts.setdefault('apache', text)
        data, size, capk, copyright = build(f, src)
        total += len(data)
        if kind == 'ofl':  # the OFL's own header names the holders and any Reserved Font Name
            copyright = ' '.join(text.split('This Font Software is licensed')[0].split()) or copyright
        faces.append(f"@font-face{{font-family:mtn{f['id']};src:url(data:font/woff2;base64,{base64.b64encode(data).decode()}) format(\"woff2\");"
                     f"font-weight:100 900;font-display:swap;size-adjust:{round(size * 100)}%;unicode-range:{RANGE}}}")
        cat.append({'id': f['id'], 'n': f['label'], 'c': f['cat'], 's': size, 'k': capk})
        credits.append([f['id'], f['family'], f['designer'], copyright, f['licence']])
    page = os.path.join(ROOT, 'index.html')
    html = open(page, encoding='utf-8').read()
    css = '<style id="nameFonts">\n' + '\n'.join(faces) + '\n</style>'
    js = ('const NAME_FONTS=' + json.dumps(cat, separators=(',', ':')) + ';\n'
          + 'const NF_CREDITS=' + json.dumps(credits, ensure_ascii=False, separators=(',', ':')) + ';\n'
          + 'const NF_LICENCES=' + json.dumps({k: re.sub(r'[ \t]+\n', '\n', v.replace('\r', '')).strip() for k, v in texts.items()}, ensure_ascii=False, separators=(',', ':')) + ';')
    for mark, body in (('css', css), ('js', js)):
        pat = re.compile(r'(/\* @name-fonts:%s \*/|<!-- @name-fonts:%s -->)\n(?:.*?\n)?(/\* @name-fonts:%s end \*/|<!-- @name-fonts:%s end -->)' % (mark, mark, mark, mark), re.S)
        assert pat.search(html), 'missing @name-fonts:%s markers in index.html' % mark
        html = pat.sub(lambda m: m.group(1) + '\n' + body + '\n' + m.group(2), html, count=1)
    open(page, 'w', encoding='utf-8').write(html)
    rows = ['| Id | In the game | Font | Designer | Licence |', '| --- | --- | --- | --- | --- |']
    for f in fonts:
        kind = 'apache' if f['licence'] == 'Apache-2.0' else 'ofl'
        rows.append(f"| {f['id']} | {f['label']} | [{f['family']}](https://github.com/google/fonts/tree/main/{kind}/{f['dir']}) | {f['designer']} | [{f['licence']}](licenses/{f['dir']}.txt) |")
    open(os.path.join(ROOT, 'fonts/CREDITS.md'), 'w', encoding='utf-8').write(
        '# Name fonts: credits\n\nGenerated by `tools/name-fonts.py` from `fonts.json`; see `README.md`. Each font is subset to the letters a name can use '
        'and renamed `MitosisName<id>`; the game shows its own label.\n\n' + '\n'.join(rows) + '\n')
    print(f'{len(fonts)} fonts, {total} bytes of woff2, {total * 4 // 3} as base64')


if __name__ == '__main__':
    main()
