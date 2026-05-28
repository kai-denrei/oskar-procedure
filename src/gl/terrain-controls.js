// terrain-controls.js — inject + wire the 3D tab's controls panel into the
// <aside id="terrain-controls">. Reuses the Grid tab's .ctrl-* styles.
//
// Controls:
//   Zoom        slider  → onChange({ zoom })
//   Orientation 4-way segmented (N/E/S/W) → onChange({ orientation })
//   Randomize   button  → onRandomize()  (new terrain seed)
//   Height      slider (max floors / amplitude 1..8) → onChange({ amplitude })
//   Roughness   slider (noise frequency) → onChange({ roughness })
//   Flatten     button  → onFlatten()    (clear heights to 0)
//
// createTerrainControls(handlers, initial) builds the markup, appends it to the
// aside, and returns { getParams, setZoom, setOrientation } so callers can read
// state or reflect external changes (e.g. wheel zoom) back into the UI.

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

// A 4-way segmented orientation selector (N/E/S/W). Calls onPick(k) with 0..3.
function makeOrientation(initial, onPick) {
  const container = document.createElement('div');
  container.className = 'ctrl-row';

  const header = document.createElement('div');
  header.className = 'ctrl-header';
  const lbl = document.createElement('span');
  lbl.className = 'ctrl-label';
  lbl.textContent = 'Orientation';
  header.appendChild(lbl);
  container.appendChild(header);

  const group = document.createElement('div');
  group.className = 'seg-group';
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'View orientation');

  const choices = [
    { value: 0, label: 'N' },
    { value: 1, label: 'E' },
    { value: 2, label: 'S' },
    { value: 3, label: 'W' },
  ];

  let current = (((initial | 0) % 4) + 4) % 4;
  const buttons = new Map();

  const apply = (val, fire) => {
    current = (((val | 0) % 4) + 4) % 4;
    for (const [v, btn] of buttons) {
      const active = v === current;
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
  apply(current, false);

  return { container, get: () => current, set: (k) => apply(k, false) };
}

/**
 * Inject + wire the 3D terrain controls.
 * @param {{
 *   onChange:(params:{zoom,orientation,amplitude,roughness})=>void,
 *   onRandomize:()=>void,
 *   onFlatten:()=>void,
 * }} handlers
 * @param {{ zoom?:number, orientation?:number, amplitude?:number, roughness?:number }} [initial]
 */
export function createTerrainControls(handlers = {}, initial = {}) {
  const aside = document.getElementById('terrain-controls');
  if (!aside) return { getParams: () => ({}) };

  const onChange = handlers.onChange || (() => {});
  const onRandomize = handlers.onRandomize || (() => {});
  const onFlatten = handlers.onFlatten || (() => {});

  const zoom0 = initial.zoom != null ? initial.zoom : 1;
  const orient0 = initial.orientation != null ? initial.orientation : 0;
  const amp0 = initial.amplitude != null ? initial.amplitude : 4;
  const rough0 = initial.roughness != null ? initial.roughness : 4;

  // --- title (hidden on mobile via existing CSS) ---
  const h1 = document.createElement('h1');
  h1.textContent = 'terrain';
  const sub = document.createElement('p');
  sub.className = 'sub';
  sub.textContent = 'fixed isometric playground';
  aside.appendChild(h1);
  aside.appendChild(sub);

  // --- Randomize button ---
  const randomBtn = document.createElement('button');
  randomBtn.type = 'button';
  randomBtn.id = 'terrain-randomize';
  randomBtn.textContent = 'Randomize terrain';
  randomBtn.addEventListener('click', () => onRandomize());
  aside.appendChild(randomBtn);

  const divider = document.createElement('hr');
  divider.className = 'ctrl-divider';
  aside.appendChild(divider);

  // --- Zoom slider ---
  const { container: rowZoom, input: inputZoom } = makeSlider(
    'ctrl-zoom', 'Zoom', 0.25, 4, 0.05, zoom0,
    (v) => `${v.toFixed(2)}×`
  );
  aside.appendChild(rowZoom);

  // --- Orientation 4-way ---
  // onPick fires onChange via the shared getParams() (defined below; this
  // closure runs only on user click, long after module init).
  const orientation = makeOrientation(orient0, () => onChange(getParams()));
  aside.appendChild(orientation.container);

  // --- Height (amplitude / max floors) ---
  const { container: rowAmp, input: inputAmp } = makeSlider(
    'ctrl-amp', 'Height', 1, 8, 1, amp0,
    (v) => `${v | 0} fl`
  );
  aside.appendChild(rowAmp);

  // --- Roughness (noise frequency / feature size) ---
  const { container: rowRough, input: inputRough } = makeSlider(
    'ctrl-rough', 'Roughness', 1, 12, 0.5, rough0,
    (v) => v.toFixed(1)
  );
  aside.appendChild(rowRough);

  const divider2 = document.createElement('hr');
  divider2.className = 'ctrl-divider';
  aside.appendChild(divider2);

  // --- Flatten button ---
  const flattenBtn = document.createElement('button');
  flattenBtn.type = 'button';
  flattenBtn.id = 'terrain-flatten';
  flattenBtn.className = 'ctrl-secondary';
  flattenBtn.textContent = 'Flatten';
  flattenBtn.addEventListener('click', () => onFlatten());
  aside.appendChild(flattenBtn);

  const getParams = () => ({
    zoom: Number(inputZoom.value),
    orientation: orientation.get(),
    amplitude: Math.round(Number(inputAmp.value)),
    roughness: Number(inputRough.value),
  });

  // Wire change events. Orientation is handled in its own onPick (fires onChange).
  inputZoom.addEventListener('input', () => onChange(getParams()));
  inputAmp.addEventListener('input', () => onChange(getParams()));
  inputRough.addEventListener('input', () => onChange(getParams()));

  return {
    getParams,
    // Reflect an external zoom change (e.g. wheel) back into the slider.
    setZoom(z) {
      inputZoom.value = String(z);
      inputZoom.dispatchEvent(new Event('input', { bubbles: false }));
    },
    setOrientation(k) {
      orientation.set(k);
    },
  };
}
