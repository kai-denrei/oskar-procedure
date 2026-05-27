#!/usr/bin/env python3
"""
Append or update `?v=<token>` on every same-origin asset URL in HTML/CSS files.

This is one technique in the cache-busting toolkit: by changing the URL with
each build the browser treats every reload as a new resource and must fetch
fresh. Combine with anti-cache meta tags (injected by install.sh), server-side
Cache-Control headers (see references/server-headers.md), and service-worker
invalidation (see references/service-worker.md) for layered defense.

Behavior:
  - HTML: rewrites href/src/poster/data attributes on <link>, <script>,
    <img>, <source>, <video>, <audio>, <iframe>, <embed>, <object>, <input>.
    Also rewrites CSS url(...) and @import inside <style> blocks.
  - CSS: rewrites url(...) and @import refs.
  - Skips external URLs (http://, https://, //, data:, blob:, javascript:,
    mailto:, tel:, fragment-only).
  - Skips node_modules, .git, dist, build, .next, .nuxt, public/cb-shapes.
  - Idempotent: running twice with the same token is a no-op.

Usage:
  python fingerprint-urls.py <token> [--target <dir>]
"""

import argparse
import os
import re
import sys
from pathlib import Path


DEFAULT_SKIP_DIRS = {
    "node_modules", ".git", "dist", "build", "out",
    ".next", ".nuxt", ".cache", ".vite", ".svelte-kit",
}

# (regex, group containing the URL). Each pattern: ( prefix )( url )( suffix )
HTML_ATTR_PATTERNS = [
    re.compile(r'(<link\b[^>]*?\bhref=")([^"]+)(")',                                          re.IGNORECASE),
    re.compile(r'(<script\b[^>]*?\bsrc=")([^"]+)(")',                                         re.IGNORECASE),
    re.compile(r'(<img\b[^>]*?\bsrc=")([^"]+)(")',                                            re.IGNORECASE),
    re.compile(r'(<(?:source|video|audio|iframe|embed)\b[^>]*?\bsrc=")([^"]+)(")',            re.IGNORECASE),
    re.compile(r'(<video\b[^>]*?\bposter=")([^"]+)(")',                                       re.IGNORECASE),
    re.compile(r'(<object\b[^>]*?\bdata=")([^"]+)(")',                                        re.IGNORECASE),
    re.compile(r'(<input\b[^>]*?\btype="image"[^>]*?\bsrc=")([^"]+)(")',                      re.IGNORECASE),
]

# CSS url(...) — captures: ( prefix incl. "url(" )( quote-or-empty )( url )( quote-or-empty )
CSS_URL_PATTERN = re.compile(r'(\burl\()\s*([\'"]?)([^\'")\s]+)(\2)\s*\)', re.IGNORECASE)
# @import "..." or @import '...'
CSS_IMPORT_PATTERN = re.compile(r'(@import\s+)([\'"])([^\'"]+)(\2)', re.IGNORECASE)
# <style>...</style> blocks
STYLE_BLOCK_PATTERN = re.compile(r'(<style\b[^>]*>)(.*?)(</style>)', re.IGNORECASE | re.DOTALL)


def is_external(url):
    u = url.strip().lower()
    if not u:
        return True
    return u.startswith((
        "http://", "https://", "//", "data:", "blob:",
        "javascript:", "mailto:", "tel:", "#",
    ))


def apply_token(url, token):
    """Append or replace `v=<token>` query parameter, preserving the rest."""
    if is_external(url):
        return url
    frag = ""
    if "#" in url:
        url, frag = url.split("#", 1)
        frag = "#" + frag
    if "?" in url:
        path, query = url.split("?", 1)
        parts = [p for p in query.split("&") if p and not p.startswith("v=")]
        parts.append("v=" + token)
        return path + "?" + "&".join(parts) + frag
    return url + "?v=" + token + frag


def rewrite_css(content, token):
    """Rewrite CSS url() and @import refs. Returns (new_content, n_changes)."""
    changes = [0]

    def repl_url(m):
        prefix, q1, url, q2 = m.group(1), m.group(2), m.group(3), m.group(4)
        if is_external(url):
            return m.group(0)
        new_url = apply_token(url, token)
        if new_url != url:
            changes[0] += 1
        return prefix + q1 + new_url + q2 + ")"

    def repl_import(m):
        prefix, q1, url, _q2 = m.group(1), m.group(2), m.group(3), m.group(4)
        if is_external(url):
            return m.group(0)
        new_url = apply_token(url, token)
        if new_url != url:
            changes[0] += 1
        return prefix + q1 + new_url + q1

    new = CSS_URL_PATTERN.sub(repl_url, content)
    new = CSS_IMPORT_PATTERN.sub(repl_import, new)
    return new, changes[0]


def rewrite_html(content, token):
    """Rewrite HTML asset URLs + CSS inside <style> blocks."""
    changes = [0]

    def repl_attr(m):
        before, url, after = m.group(1), m.group(2), m.group(3)
        if is_external(url):
            return m.group(0)
        new_url = apply_token(url, token)
        if new_url != url:
            changes[0] += 1
        return before + new_url + after

    new = content
    for pat in HTML_ATTR_PATTERNS:
        new = pat.sub(repl_attr, new)

    def style_repl(m):
        open_tag, css, close_tag = m.group(1), m.group(2), m.group(3)
        new_css, n = rewrite_css(css, token)
        changes[0] += n
        return open_tag + new_css + close_tag
    new = STYLE_BLOCK_PATTERN.sub(style_repl, new)

    return new, changes[0]


def walk_target(target, skip_dirs):
    for root, dirs, files in os.walk(target):
        # Filter dirs in-place so os.walk doesn't descend into them
        dirs[:] = [d for d in dirs if d not in skip_dirs and not d.startswith(".")]
        rel = str(Path(root).relative_to(target)).replace("\\", "/")
        if rel.startswith("public/cb-shapes") or "/public/cb-shapes" in rel:
            continue
        for f in files:
            yield Path(root) / f


def main():
    ap = argparse.ArgumentParser(description="Fingerprint asset URLs with ?v=<token>")
    ap.add_argument("token", help="cache-bust token, e.g. cbd1dddb")
    ap.add_argument("--target", default=".", help="project root (default: .)")
    ap.add_argument("--quiet", action="store_true", help="suppress per-file output")
    args = ap.parse_args()

    target = Path(args.target).resolve()
    if not target.is_dir():
        sys.exit("target directory does not exist: " + str(target))

    n_files, n_changes = 0, 0
    for f in walk_target(target, set(DEFAULT_SKIP_DIRS)):
        ext = f.suffix.lower()
        if ext not in (".html", ".htm", ".css"):
            continue
        try:
            content = f.read_text(errors="replace")
        except OSError:
            continue
        if ext == ".css":
            new, changes = rewrite_css(content, args.token)
        else:
            new, changes = rewrite_html(content, args.token)
        if changes and new != content:
            f.write_text(new)
            n_files += 1
            n_changes += changes
            if not args.quiet:
                print("  ✓ " + str(f.relative_to(target)) + " (" + str(changes) + " URLs)")

    print("\nfingerprinted " + str(n_changes) + " URLs across " + str(n_files) +
          " files with v=" + args.token)


if __name__ == "__main__":
    main()
