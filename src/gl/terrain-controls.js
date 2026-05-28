// terrain-controls.js — inject + wire the 3D tab's controls panel into the
// <aside id="terrain-controls">. Reuses the Grid tab's .ctrl-* styles.
//
// Controls:
//   Biome       grid of six segmented buttons → onChange({ biome })
//   Zoom        slider  → onChange({ zoom })
//   Orientation 4-way segmented (N/E/S/W) → onChange({ orientation })
//   Randomize   button  → onRandomize()  (new terrain seed)
//   Height      slider (max floors / amplitude 1..8) → onChange({ amplitude })
//   Roughness   slider (noise frequency) → onChange({ roughness })
//   Flatten     button  → onFlatten()    (clear heights to 0)
//
// createTerrainControls(handlers, initial) builds the markup, appends it to the
// aside, and returns { getParams, setZoom, setOrientation, setBiome } so callers
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

// Biome picker — a 2×3 grid of segmented buttons (Dunes / Mountains / Forest
// in row 1, Meadows / Swamps / Quarry in row 2). Same .seg-btn/.seg-active
// styling as the orientation picker, just stacked into rows so it fits the
// narrow side panel and stacks cleanly on mobile.
function makeBiomePicker(biomes, initialId, onPick) {
  const container = document.createElement('div');
  container.className = 'ctrl-row';

  const header = document.createElement('div');
  header.className = 'ctrl-header';
  const lbl = document.createElement('span');
  lbl.className = 'ctrl-label';
  lbl.textContent = 'Biome';
  header.appendChild(lbl);
  container.appendChild(header);

  // Wrap in a flex-column so multiple .seg-group rows stack tightly.
  const stack = document.createElement('div');
  stack.className = 'biome-grid';

  let current = initialId;
  const buttons = new Map();

  const applyVisual = () => {
    for (const [id, btn] of buttons) {
      const active = id === current;
      btn.classList.toggle('seg-active', active);
      btn.setAttribute('aria-checked', active ? 'true' : 'false');
    }
  };

  // Two rows of three (6 biomes / 3 per row = 2 rows).
  for (let row = 0; row < 2; row++) {
    const group = document.createElement('div');
    group.className = 'seg-group';
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', 'Biome ' + (row === 0 ? 'row 1' : 'row 2'));
    for (let col = 0; col < 3; col++) {
      const i = row * 3 + col;
      if (i >= biomes.length) break;
      const b = biomes[i];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'seg-btn';
      btn.textContent = b.label;
      btn.setAttribute('role', 'radio');
      btn.dataset.biome = b.id;
      btn.addEventListener('click', () => {
        if (current !== b.id) {
          current = b.id;
          applyVisual();
          onPick(current);
        }
      });
      buttons.set(b.id, btn);
      group.appendChild(btn);
    }
    stack.appendChild(group);
  }

  container.appendChild(stack);
  applyVisual();

  return { container, get: () => current, set: (id) => { current = id; applyVisual(); } };
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

// A 2-way segmented build-mode selector (Raise / Lower).
// Calls onPick('raise'|'lower') when the selection changes.
function makeBuildMode(initial, onPick) {
  const container = document.createElement('div');
  container.className = 'ctrl-row';

  const header = document.createElement('div');
  header.className = 'ctrl-header';
  const lbl = document.createElement('span');
  lbl.className = 'ctrl-label';
  lbl.textContent = 'Build mode';
  header.appendChild(lbl);
  container.appendChild(header);

  const group = document.createElement('div');
  group.className = 'seg-group';
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Build mode');

  const choices = [
    { value: 'raise', label: 'Raise' },
    { value: 'lower', label: 'Lower' },
  ];

  let current = initial === 'lower' ? 'lower' : 'raise';
  const buttons = new Map();

  const apply = (val, fire) => {
    current = val;
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

  return { container, get: () => current, set: (v) => apply(v, false) };
}

/**
 * Inject + wire the 3D terrain controls.
 * @param {{
 *   onChange:(params:{biome,zoom,orientation,amplitude,roughness,buildMode})=>void,
 *   onRandomize:()=>void,
 *   onFlatten:()=>void,
 *   biomes?: Array<{id,label}>,
 * }} handlers
 * @param {{ biome?:string, zoom?:number, orientation?:number, amplitude?:number, roughness?:number, buildMode?:string }} [initial]
 */
export function createTerrainControls(handlers = {}, initial = {}) {
  const aside = document.getElementById('terrain-controls');
  if (!aside) return { getParams: () => ({}) };

  const onChange = handlers.onChange || (() => {});
  const onRandomize = handlers.onRandomize || (() => {});
  const onFlatten = handlers.onFlatten || (() => {});
  const biomes = handlers.biomes || [];

  const biome0 = initial.biome != null ? initial.biome : (biomes[0] && biomes[0].id) || 'dunes';
  const zoom0 = initial.zoom != null ? initial.zoom : 1;
  const orient0 = initial.orientation != null ? initial.orientation : 0;
  const rough0 = initial.roughness != null ? initial.roughness : 4;
  const buildMode0 = initial.buildMode === 'lower' ? 'lower' : 'raise';

  // Per-biome maxHeight lookup (fallback 8 for unknown). Used to re-range the
  // Height slider and default it to the biome's cap on each biome change.
  const getBiomeMaxHeight = (id) => {
    const b = biomes.find((x) => x.id === id);
    return (b && b.maxHeight != null) ? b.maxHeight : 8;
  };

  // Initial height slider value: clamp current amplitude to the biome cap;
  // default to the biome's maxHeight (full range) if amplitude not given.
  const maxH0 = getBiomeMaxHeight(biome0);
  const amp0 = initial.amplitude != null
    ? Math.max(1, Math.min(maxH0, Math.round(initial.amplitude)))
    : maxH0;

  // --- title (hidden on mobile via existing CSS) ---
  const h1 = document.createElement('h1');
  h1.textContent = 'terrain';
  const sub = document.createElement('p');
  sub.className = 'sub';
  sub.textContent = 'fixed isometric playground';
  aside.appendChild(h1);
  aside.appendChild(sub);

  // --- Biome picker (2×3 segmented) ---
  // (Placed first so it reads as the primary choice; sliders below tune it.)
  let biomePicker = { get: () => biome0, set: () => {} };
  if (biomes.length) {
    biomePicker = makeBiomePicker(biomes, biome0, (id) => {
      // Re-range the Height slider to the new biome's maxHeight and reset its
      // value to that cap (so generation uses the full range by default).
      const newMax = getBiomeMaxHeight(id);
      inputAmp.max = String(newMax);
      // Clamp current value to the new max; if it was already ≤ max keep it.
      const clamped = Math.max(1, Math.min(newMax, Math.round(Number(inputAmp.value))));
      inputAmp.value = String(clamped);
      ampReadout.textContent = `${clamped} fl`;
      onChange(getParams());
    });
    aside.appendChild(biomePicker.container);
  }

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
  // Max is set to the active biome's maxHeight; re-ranged when biome changes.
  const { container: rowAmp, input: inputAmp, readout: ampReadout } = makeSlider(
    'ctrl-amp', 'Height', 1, maxH0, 1, amp0,
    (v) => `${v | 0} fl`
  );
  aside.appendChild(rowAmp);

  // --- Roughness (noise frequency / feature size) ---
  const { container: rowRough, input: inputRough } = makeSlider(
    'ctrl-rough', 'Roughness', 1, 12, 0.5, rough0,
    (v) => v.toFixed(1)
  );
  aside.appendChild(rowRough);

  // --- Build mode (Raise / Lower) ---
  const buildModeCtrl = makeBuildMode(buildMode0, () => onChange(getParams()));
  aside.appendChild(buildModeCtrl.container);

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
    biome: biomePicker.get(),
    zoom: Number(inputZoom.value),
    orientation: orientation.get(),
    amplitude: Math.round(Number(inputAmp.value)),
    roughness: Number(inputRough.value),
    buildMode: buildModeCtrl.get(),
  });

  // Wire change events. Orientation + biome are handled in their own onPick.
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
    setBiome(id) {
      biomePicker.set(id);
    },
    setBuildMode(mode) {
      buildModeCtrl.set(mode);
    },
  };
}
