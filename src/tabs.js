// tabs.js — tab bar wiring for oskar-procedure.
// Manages the Grid / 3D / Stålberg's Breakthrough tabs.
// Import from main.js so it enters the module graph and gets fingerprinted.

// Hash → view-id map (so …/#3d, …/#grid, …/#about open that tab on load and
// headless screenshots can target any tab). Anything else falls back to Grid.
const HASH_TO_VIEW = {
  '#grid': 'view-grid',
  '#3d': 'view-3d',
  '#about': 'view-about',
};

// Views whose content is a <canvas> that sizes to 0 while hidden — switching TO
// them must dispatch a resize so the newly-shown canvas re-fits itself.
const CANVAS_VIEWS = new Set(['view-grid', 'view-3d']);

export function initTabs() {
  const tabButtons = document.querySelectorAll('[role="tab"]');
  const views = document.querySelectorAll('.view');

  function activateTab(tabId) {
    tabButtons.forEach((btn) => {
      const active = btn.dataset.tab === tabId;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    views.forEach((view) => {
      if (view.id === tabId) {
        view.removeAttribute('hidden');
      } else {
        view.setAttribute('hidden', '');
      }
    });

    // Canvas-backed views had 0 dimensions while hidden. Dispatch a resize so
    // the now-visible canvas re-measures and re-fits (grid AND 3d).
    if (CANVAS_VIEWS.has(tabId)) {
      window.dispatchEvent(new Event('resize'));
    }
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      activateTab(btn.dataset.tab);
    });
  });

  // Honor location.hash to open a specific tab on load (also lets headless
  // screenshots target it with …/#3d, …/#about, etc.). Default to Grid.
  const startTab = HASH_TO_VIEW[location.hash] || 'view-grid';
  activateTab(startTab);
}
