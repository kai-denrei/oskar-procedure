// pwa.js — service worker registration + consent-based update UX.
//
// Registers ./sw.js at scope './' (base-path portable: works at localhost root
// and under GitHub Pages /oskar-procedure/). When a new SW finishes installing
// while one is already controlling the page, we DON'T auto-activate it — we
// show a non-blocking dismissible toast. The user clicks "Refresh", we post
// SKIP_WAITING to the waiting worker, and on controllerchange we reload once.
//
// This keeps cache invalidation explicit and consent-based (the operator's
// recurring stale-cache pain): no silent swap mid-session, no pinned-forever
// old build.

if ('serviceWorker' in navigator) {
  // Defer registration until after load so it never blocks first paint.
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .then((reg) => watchForUpdate(reg))
      .catch((err) => console.warn('[pwa] SW registration failed:', err));
  });

  // Reload exactly once when the new SW takes control (after SKIP_WAITING).
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
}

function watchForUpdate(reg) {
  // A worker may already be waiting (e.g. installed in a previous visit).
  if (reg.waiting && navigator.serviceWorker.controller) {
    showUpdateToast(reg.waiting);
  }

  reg.addEventListener('updatefound', () => {
    const installing = reg.installing;
    if (!installing) return;
    installing.addEventListener('statechange', () => {
      if (
        installing.state === 'installed' &&
        navigator.serviceWorker.controller // a controller exists => this is an UPDATE, not first install
      ) {
        showUpdateToast(installing);
      }
    });
  });
}

let toastShown = false;

function showUpdateToast(worker) {
  if (toastShown) return;
  toastShown = true;

  const toast = document.createElement('div');
  toast.className = 'pwa-toast';
  toast.setAttribute('role', 'status');

  const msg = document.createElement('span');
  msg.className = 'pwa-toast__msg';
  msg.textContent = 'New version available';

  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.className = 'pwa-toast__refresh';
  refreshBtn.textContent = 'Refresh';
  refreshBtn.addEventListener('click', () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Updating…';
    // Tell the waiting worker to activate. controllerchange handler reloads.
    worker.postMessage({ type: 'SKIP_WAITING' });
  });

  const dismissBtn = document.createElement('button');
  dismissBtn.type = 'button';
  dismissBtn.className = 'pwa-toast__dismiss';
  dismissBtn.setAttribute('aria-label', 'Dismiss');
  dismissBtn.textContent = '×';
  dismissBtn.addEventListener('click', () => {
    toast.remove();
    toastShown = false; // allow re-surface if another update lands later
  });

  toast.append(msg, refreshBtn, dismissBtn);

  const mount = () => document.body.appendChild(toast);
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
}
