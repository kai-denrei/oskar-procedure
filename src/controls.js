// controls.js — inject and wire the M1/H1 parameter UI into #controls.
// Exports createControls(onChange, initial) which builds the markup, appends it
// to <aside id="controls">, and calls onChange(params) whenever any value changes.
//
// params shape: { seeder, r, rings, pullRate, nIters }
//   seeder: 'poisson' | 'hex'  — the shape selector
//   r:      Poisson disk radius (shown only when seeder === 'poisson')
//   rings:  hexagon ring count (shown only when seeder === 'hex')
//   pullRate, nIters: apply to both seeders.

/**
 * Build a labeled range slider row with a live value readout.
 * @returns {{ container: HTMLElement, input: HTMLInputElement, readout: HTMLSpanElement }}
 */
function makeSlider(id, label, min, max, step, value, fmt) {
  const container = document.createElement('div');
  container.className = 'ctrl-row';

  const header = document.createElement('div');
  header.className = 'ctrl-header';

  const lbl = document.createElement('label');
  lbl.htmlFor = id;
  lbl.textContent = label;

  const readout = document.createElement('span');
  readout.className = 'ctrl-value';
  readout.textContent = fmt(value);

  header.appendChild(lbl);
  header.appendChild(readout);

  const input = document.createElement('input');
  input.type = 'range';
  input.id = id;
  input.min = min;
  input.max = max;
  input.step = step;
  input.value = value;

  container.appendChild(header);
  container.appendChild(input);

  input.addEventListener('input', () => {
    readout.textContent = fmt(Number(input.value));
  });

  return { container, input, readout };
}

/**
 * Build the shape selector: two segmented buttons (Poisson | Hexagon).
 * Calls onPick(seeder) when the active choice changes.
 * @returns {{ container: HTMLElement, get: () => 'poisson'|'hex', set: (s:string)=>void }}
 */
function makeShapeSelector(initial, onPick) {
  const container = document.createElement('div');
  container.className = 'ctrl-row';

  const header = document.createElement('div');
  header.className = 'ctrl-header';
  const lbl = document.createElement('span');
  lbl.className = 'ctrl-label';
  lbl.textContent = 'Shape';
  header.appendChild(lbl);
  container.appendChild(header);

  const group = document.createElement('div');
  group.className = 'seg-group';
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Seed shape');

  const choices = [
    { value: 'poisson', label: 'Poisson' },
    { value: 'hex', label: 'Hexagon' },
  ];

  let current = initial === 'hex' ? 'hex' : 'poisson';
  const buttons = new Map();

  const apply = (val, fire) => {
    current = val;
    for (const [v, btn] of buttons) {
      const active = v === val;
      btn.classList.toggle('seg-active', active);
      btn.setAttribute('aria-checked', active ? 'true' : 'false');
    }
    if (fire) onPick(current);
  };

  for (const { value, label } of choices) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'seg-btn';
    btn.textContent = label;
    btn.setAttribute('role', 'radio');
    btn.addEventListener('click', () => {
      if (current !== value) apply(value, true);
    });
    buttons.set(value, btn);
    group.appendChild(btn);
  }

  container.appendChild(group);
  apply(current, false); // set initial active state without firing

  return {
    container,
    get: () => current,
    set: (s) => apply(s === 'hex' ? 'hex' : 'poisson', false),
  };
}

/**
 * Inject controls into <aside id="controls"> and wire them.
 * @param {(params: { seeder, r, rings, pullRate, nIters }) => void} onChange
 * @param {{ seeder?: 'poisson'|'hex', rings?: number }} [initial] - boot overrides (e.g. from URL)
 * @returns {{ getParams: () => { seeder, r, rings, pullRate, nIters } }}
 */
export function createControls(onChange, initial = {}) {
  const aside = document.getElementById('controls');

  // --- divider ---
  const divider = document.createElement('hr');
  divider.className = 'ctrl-divider';
  aside.appendChild(divider);

  // --- Shape selector (Poisson | Hexagon) ---
  const selector = makeShapeSelector(initial.seeder, () => {
    syncVisibility();
    fire();
  });
  selector.container.classList.add('ctrl-shape'); // targetable for the mobile layout
  aside.appendChild(selector.container);

  // --- Point density (Poisson radius — smaller = more points) ---
  const { container: rowR, input: inputR } = makeSlider(
    'ctrl-r',
    'Point density',
    0.06, 0.16, 0.005, 0.1,
    (v) => `r ${v.toFixed(3)}`
  );
  aside.appendChild(rowR);

  // --- Rings (hexagon ring count) ---
  const initialRings = Number.isFinite(initial.rings)
    ? Math.min(6, Math.max(2, Math.round(initial.rings)))
    : 4;
  const { container: rowRings, input: inputRings } = makeSlider(
    'ctrl-rings',
    'Rings',
    2, 6, 1, initialRings,
    (v) => `${v | 0}`
  );
  aside.appendChild(rowRings);

  // --- Pull rate (both seeders) ---
  const { container: rowPull, input: inputPull } = makeSlider(
    'ctrl-pull',
    'Pull rate',
    0.05, 0.6, 0.01, 0.3,
    (v) => v.toFixed(2)
  );
  aside.appendChild(rowPull);

  // --- Iterations (both seeders) ---
  const { container: rowIters, input: inputIters } = makeSlider(
    'ctrl-iters',
    'Iterations',
    10, 200, 5, 100,
    (v) => `${v | 0}`
  );
  aside.appendChild(rowIters);

  // --- Seed readout ---
  const seedRow = document.createElement('div');
  seedRow.className = 'ctrl-row ctrl-seed-row';
  const seedLbl = document.createElement('span');
  seedLbl.className = 'ctrl-label';
  seedLbl.textContent = 'Seed';
  const seedVal = document.createElement('span');
  seedVal.className = 'ctrl-value ctrl-seed-val';
  seedVal.id = 'seed-readout';
  seedVal.textContent = '—';
  seedRow.appendChild(seedLbl);
  seedRow.appendChild(seedVal);
  aside.appendChild(seedRow);

  // Show the slider relevant to the active seeder, hide the other.
  function syncVisibility() {
    const isHex = selector.get() === 'hex';
    rowR.hidden = isHex;
    rowRings.hidden = !isHex;
  }
  syncVisibility();

  // helper to read all current params
  const getParams = () => ({
    seeder: selector.get(),
    r: Number(inputR.value),
    rings: Math.round(Number(inputRings.value)),
    pullRate: Number(inputPull.value),
    nIters: Math.round(Number(inputIters.value)),
  });

  // fire onChange on any control change
  const fire = () => onChange(getParams());
  inputR.addEventListener('input', fire);
  inputRings.addEventListener('input', fire);
  inputPull.addEventListener('input', fire);
  inputIters.addEventListener('input', fire);

  return { getParams };
}

/**
 * Update the seed readout display.
 * @param {number} seed
 */
export function setSeedDisplay(seed) {
  const el = document.getElementById('seed-readout');
  if (el) el.textContent = seed.toString(16).padStart(8, '0').toUpperCase();
}
