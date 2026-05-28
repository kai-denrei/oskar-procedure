// map-controls.js — inject + wire the Map tab's controls panel into the
// <aside id="map-controls">. Reuses the Grid/3D tab's .ctrl-* / .seg-* styles
// so it stacks on mobile via the existing @media(max-width:768px) rules.
//
// Controls (the biome PICKER is the canvas right-click menu, not a panel widget):
//   Tiles        slider (radius 1..3 → 7/19/37 tiles) → onChange({ radius })
//   Randomize    button  → onRandomize()  (re-seed biomes + per-tile grids)
//   Orientation  4-way segmented (N/E/S/W) → onChange({ orientation })
//   Zoom         slider  → onChange({ zoom })
//
// createMapControls(handlers, initial) builds the markup, appends it to the
// aside, and returns { getParams, setZoom, setOrientation, setRadius } so callers
// can read state or reflect external changes (e.g. wheel zoom) back into the UI.

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
 * Inject + wire the Map controls.
 * @param {{
 *   onChange:(params:{radius,zoom,orientation})=>void,
 *   onRandomize:()=>void,
 * }} handlers
 * @param {{ radius?:number, zoom?:number, orientation?:number }} [initial]
 */
export function createMapControls(handlers = {}, initial = {}) {
  const aside = document.getElementById('map-controls');
  if (!aside) return { getParams: () => ({}) };

  const onChange = handlers.onChange || (() => {});
  const onRandomize = handlers.onRandomize || (() => {});

  const radius0 = initial.radius != null ? initial.radius : 2;
  const zoom0 = initial.zoom != null ? initial.zoom : 1;
  const orient0 = initial.orientation != null ? initial.orientation : 0;

  // --- title (hidden on mobile via existing CSS) ---
  const h1 = document.createElement('h1');
  h1.textContent = 'map';
  const sub = document.createElement('p');
  sub.className = 'sub';
  sub.textContent = 'hexagon board';
  aside.appendChild(h1);
  aside.appendChild(sub);

  // --- Tiles slider (radius → tile count) ---
  const tileCount = (R) => 1 + 3 * R * (R + 1);
  const { container: rowTiles, input: inputTiles } = makeSlider(
    'map-tiles', 'Tiles', 1, 3, 1, radius0,
    (v) => `${tileCount(v | 0)} tiles`
  );
  aside.appendChild(rowTiles);

  // --- Randomize button ---
  const randomBtn = document.createElement('button');
  randomBtn.type = 'button';
  randomBtn.id = 'map-randomize';
  randomBtn.textContent = 'Randomize map';
  randomBtn.addEventListener('click', () => onRandomize());
  aside.appendChild(randomBtn);

  const divider = document.createElement('hr');
  divider.className = 'ctrl-divider';
  aside.appendChild(divider);

  // --- Orientation 4-way ---
  const orientation = makeOrientation(orient0, () => onChange(getParams()));
  aside.appendChild(orientation.container);

  // --- Zoom slider ---
  const { container: rowZoom, input: inputZoom } = makeSlider(
    'map-zoom', 'Zoom', 0.25, 4, 0.05, zoom0,
    (v) => `${v.toFixed(2)}×`
  );
  aside.appendChild(rowZoom);

  const getParams = () => ({
    radius: Math.round(Number(inputTiles.value)),
    zoom: Number(inputZoom.value),
    orientation: orientation.get(),
  });

  // Tiles + zoom fire onChange (orientation handled in its own onPick).
  inputTiles.addEventListener('input', () => onChange(getParams()));
  inputZoom.addEventListener('input', () => onChange(getParams()));

  return {
    getParams,
    setZoom(z) {
      inputZoom.value = String(z);
      inputZoom.dispatchEvent(new Event('input', { bubbles: false }));
    },
    setOrientation(k) {
      orientation.set(k);
    },
    setRadius(R) {
      inputTiles.value = String(R);
      inputTiles.dispatchEvent(new Event('input', { bubbles: false }));
    },
  };
}
