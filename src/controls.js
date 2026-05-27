// controls.js — inject and wire the M1 parameter sliders into #controls.
// Exports createControls(onChange) which builds the slider markup, appends it
// to <aside id="controls">, and calls onChange(params) whenever any value changes.
//
// params shape: { r, pullRate, nIters }

/**
 * Build a labeled range slider row with a live value readout.
 * @param {string} id       - element id for the input
 * @param {string} label    - display label
 * @param {number} min
 * @param {number} max
 * @param {number} step
 * @param {number} value    - initial value
 * @param {(v: number) => string} fmt - format the value for display
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
 * Inject controls into <aside id="controls"> and wire them.
 * @param {(params: { r: number, pullRate: number, nIters: number }) => void} onChange
 * @returns {{ getParams: () => { r, pullRate, nIters } }}
 */
export function createControls(onChange) {
  const aside = document.getElementById('controls');

  // --- divider ---
  const divider = document.createElement('hr');
  divider.className = 'ctrl-divider';
  aside.appendChild(divider);

  // --- Point density (r: Poisson radius — smaller = more points) ---
  const { container: rowR, input: inputR } = makeSlider(
    'ctrl-r',
    'Point density',
    0.06, 0.16, 0.005, 0.1,
    (v) => `r ${v.toFixed(3)}`
  );
  aside.appendChild(rowR);

  // --- Pull rate ---
  const { container: rowPull, input: inputPull } = makeSlider(
    'ctrl-pull',
    'Pull rate',
    0.05, 0.6, 0.01, 0.3,
    (v) => v.toFixed(2)
  );
  aside.appendChild(rowPull);

  // --- Iterations ---
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

  // helper to read all current params
  const getParams = () => ({
    r: Number(inputR.value),
    pullRate: Number(inputPull.value),
    nIters: Math.round(Number(inputIters.value)),
  });

  // fire onChange on any slider change
  const fire = () => onChange(getParams());
  inputR.addEventListener('input', fire);
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
