// tabs.js — tab bar wiring for oskar-procedure.
// Manages the Grid / Stålberg's Breakthrough tabs.
// Import from main.js so it enters the module graph and gets fingerprinted.

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

    // When switching TO the grid tab, the canvas had 0 dimensions while hidden.
    // Dispatch a resize event so the canvas re-fits itself.
    if (tabId === 'view-grid') {
      window.dispatchEvent(new Event('resize'));
    }
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      activateTab(btn.dataset.tab);
    });
  });

  // Honor location.hash === '#about' to open the About tab on load (also lets
  // headless screenshots target it with …/#about).
  const startTab = location.hash === '#about' ? 'view-about' : 'view-grid';
  activateTab(startTab);
}
