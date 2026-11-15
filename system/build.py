#!/usr/bin/env python3
"""Assemble the single-file, offline MARSWALK system (marswalk.html).

The source of truth for code lives in system/src/ (template.html, styles.css, app.js).
The embedded NASA/USGS-derived data block is taken from an existing build (default:
marswalk.html at the repository root) so the ~11 MB dataset is stored only once.

    python3 system/build.py                       # rebuild marswalk.html in place
    python3 system/build.py --data-from OLD.html  # take the data block from another build
    python3 system/build.py --data data.json      # take data from a JSON file
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = Path(__file__).resolve().parent / 'src'
DATA_RE = re.compile(r'<script id="mars-data" type="application/json">(.*?)</script>', re.S)
REQUIRED = ('regions', 'imagery', 'environment')


def load_data(args) -> str:
    if args.data:
        text = Path(args.data).read_text(encoding='utf-8')
    else:
        html = Path(args.data_from).read_text(encoding='utf-8')
        match = DATA_RE.search(html)
        if not match:
            raise SystemExit(f'No mars-data block found in {args.data_from}')
        text = match.group(1).strip()
    data = json.loads(text)  # validate before embedding
    missing = [k for k in REQUIRED if k not in data]
    if missing:
        raise SystemExit(f'Data block is missing keys: {missing}')
    for key in ('m1', 'expanded'):
        if key not in data['regions']:
            raise SystemExit(f'Data block is missing region {key!r}')
    if '</script' in text.lower():
        raise SystemExit('Data block contains a closing script tag; refusing to embed')
    return text


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--data-from', default=str(ROOT / 'marswalk.html'))
    ap.add_argument('--data')
    ap.add_argument('--out', default=str(ROOT / 'marswalk.html'))
    args = ap.parse_args()

    data = load_data(args)
    template = (SRC / 'template.html').read_text(encoding='utf-8')
    css = (SRC / 'styles.css').read_text(encoding='utf-8')
    js = (SRC / 'app.js').read_text(encoding='utf-8')
    if '</script' in js.lower():
        raise SystemExit('app.js must not contain a closing script tag')
    out = (template.replace('/*__CSS__*/', css, 1)
                   .replace('/*__JS__*/', js, 1)
                   .replace('/*__DATA__*/', data, 1))
    Path(args.out).write_text(out, encoding='utf-8')
    print(f'wrote {args.out} · {len(out.encode()) / 1e6:.2f} MB · data sha256 {hashlib.sha256(data.encode()).hexdigest()[:16]}…')


if __name__ == '__main__':
    main()
