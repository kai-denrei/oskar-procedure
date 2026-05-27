// cb-badge.js — runtime cache-bust visual badge.
// Reads <meta name="cb" content="..."> and renders 3 cell tiles in the corner.
// Drop in via: <script src="/cb-badge.js" defer></script>

(function () {
  const meta = document.querySelector('meta[name="cb"]');
  if (!meta) return;

  const raw = meta.getAttribute("content") || "";
  const hex = raw.replace(/^0x/i, "").toLowerCase().padStart(8, "0").slice(0, 8);
  if (!/^[0-9a-f]{8}$/.test(hex)) return;

  const cells = [0, 1, 2].map(i => parseInt(hex.slice(i * 2, i * 2 + 2), 16) % 64);
  const pad = n => String(n).padStart(2, "0");

  // Derive the cb-shapes URL prefix + extension from the existing favicon
  // <link>. The favicon is rendered by the framework (Astro, Next, etc.)
  // and respects the deployment's base path — so on a sub-path deploy like
  // GitHub Pages (/<repo>/...) it will already point at the right place.
  // Bare "/cb-shapes/..." 404s under a sub-path; on iOS Safari the broken
  // <img> renders as the system placeholder, which reads as "???" in a row.
  // Falls back to "/cb-shapes/" + ".svg" only when no such link exists.
  let cellPrefix = "/cb-shapes/";
  let cellExt = ".svg";
  const fav = document.querySelector(
    'link[rel~="icon"][href*="/cb-shapes/"]'
  );
  if (fav) {
    const href = fav.getAttribute("href") || "";
    const m = href.match(/^(.*\/cb-shapes\/)\d{2}\.(svg|webp)(\?.*)?$/);
    if (m) {
      cellPrefix = m[1];
      cellExt = "." + m[2];
    }
  }

  // Honor a hint in the meta tag if provided (e.g. content="cbd1dddb#dev").
  // Anything after '#' is treated as a label.
  const labelMatch = raw.match(/#(.+)$/);
  const label = labelMatch ? labelMatch[1] : "";

  // Build the badge.
  const badge = document.createElement("div");
  badge.id = "cb-badge";
  badge.setAttribute("data-cb", hex);
  badge.style.cssText = [
    "position:fixed",
    "bottom:8px",
    "right:8px",
    "display:flex",
    "gap:2px",
    "padding:4px 6px",
    "background:#111",
    "border:1px solid #2a2a2a",
    "border-radius:6px",
    "z-index:2147483647",
    "font:11px ui-monospace,SFMono-Regular,Menlo,monospace",
    "color:#888",
    "align-items:center",
    "user-select:none"
  ].join(";");

  const tiles = cells.map(c => {
    const img = document.createElement("img");
    img.src = `${cellPrefix}${pad(c)}${cellExt}`;
    img.alt = "";
    img.width = 20;
    img.height = 20;
    img.style.cssText = "display:block;border-radius:2px";
    // If the chosen extension 404s, try the other one once (covers installs
    // where cb-shapes ship as svg-only or webp-only). Guarded so it can't
    // loop forever between the two.
    img.onerror = () => {
      if (img.dataset.cbFallback) return;
      img.dataset.cbFallback = "1";
      const alt = cellExt === ".webp" ? ".svg" : ".webp";
      img.src = `${cellPrefix}${pad(c)}${alt}`;
    };
    return img;
  });
  tiles.forEach(t => badge.appendChild(t));

  const hexEl = document.createElement("span");
  hexEl.textContent = label ? `${hex} · ${label}` : hex;
  hexEl.style.cssText = "margin-left:6px;color:#bbb";
  badge.appendChild(hexEl);

  // Click to copy the token.
  badge.style.cursor = "pointer";
  badge.title = "click to copy cache-bust token";
  badge.addEventListener("click", () => {
    navigator.clipboard?.writeText(hex);
    hexEl.style.color = "#5dcaa5";
    setTimeout(() => { hexEl.style.color = "#bbb"; }, 600);
  });

  // Mount once DOM is ready.
  if (document.body) {
    document.body.appendChild(badge);
  } else {
    document.addEventListener("DOMContentLoaded", () => document.body.appendChild(badge));
  }
})();
