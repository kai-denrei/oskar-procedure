#!/usr/bin/env python3
"""Fingerprint the ES-module import graph with ?v=<token>.

`fingerprint-urls.py` rewrites HTML asset URLs (the entry `<script>`/`<link>`),
but native ES-module imports inside JS — `import ... from './grid.js'` — carry no
?v=. With a long CDN/browser max-age, a stale module can be served even when the
entry HTML is fresh (fresh index.html + fresh main.js, but a cached old grid.js).

This rewrites every RELATIVE `.js` import specifier (static `from '...'`,
side-effect `import '...'`, and dynamic `import('...')`) under src/ and vendor/ to
carry `?v=<token>`. Each build then yields a unique set of module URLs, so no
cache layer (browser HTTP cache, CDN, or service worker) can serve a stale module.

Idempotent: an existing `?v=...` is replaced, not stacked.

usage: fingerprint-imports.py <token> [--target <dir>] [--quiet]
"""
import re
import sys
import pathlib

# from './x.js'  |  from "./x.js"  |  import('./x.js')  |  import './x.js'
# captures: (1) the keyword+opener up to the quote, (2) quote, (3) relative path
# ending .js, then swallows any existing ?v=..., then (4) closing quote.
_PAT = re.compile(
    r"""((?:from|import)\s*\(?\s*)(['"])(\.\.?/[^'"?]+\.js)(?:\?v=[0-9a-f]+)?(['"])"""
)


def fingerprint_text(text: str, token: str) -> str:
    return _PAT.sub(lambda m: f"{m.group(1)}{m.group(2)}{m.group(3)}?v={token}{m.group(4)}", text)


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    token = args[0]
    quiet = "--quiet" in sys.argv
    target = pathlib.Path(args[1]) if len(args) > 1 else pathlib.Path(".")

    count = 0
    for sub in ("src", "vendor"):
        base = target / sub
        if not base.is_dir():
            continue
        for f in sorted(base.rglob("*.js")):
            text = f.read_text()
            new = fingerprint_text(text, token)
            if new != text:
                f.write_text(new)
                count += 1
                if not quiet:
                    print(f"  ✓ import graph fingerprinted in {f}")
    if not quiet:
        print(f"fingerprinted module imports in {count} JS files with v={token}")


if __name__ == "__main__":
    main()
