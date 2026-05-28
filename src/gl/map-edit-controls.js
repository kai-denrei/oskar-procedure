// map-edit-controls.js — the Map FOCUS-mode panel, injected into
// <aside id="map-edit-controls">. Mirrors map-controls.js styling (.ctrl-*,
// .seg-*). Phase-1 widgets: a Raise/Lower toggle and a "← Board" exit button.
// Phase-2 adds the object palette (Sculpt chip + Tree/Rock/Building/Water).
//
//   createMapEditControls({ onTool, onExit }) -> { reset }
//     onTool({ mode, dir, objectId })  fires when a widget changes the tool
//     onExit()                          "← Board" clicked
//     reset()                           restores Raise + Sculpt selection (no onTool fired)

import { OBJECTS } from '../structures/objects.js';

export function createMapEditControls(handlers = {}) {
  const aside = document.getElementById('map-edit-controls');
  if (!aside) return { setMode() {} };
  aside.innerHTML = '';
  const onTool = handlers.onTool || (() => {});
  const onExit = handlers.onExit || (() => {});

  const back = document.createElement('button');
  back.type = 'button';
  back.id = 'map-edit-back';
  back.textContent = '← Board';
  back.addEventListener('click', () => onExit());
  aside.appendChild(back);

  const h1 = document.createElement('h1');
  h1.textContent = 'edit tile';
  aside.appendChild(h1);

  // Raise / Lower segmented toggle (2-way).
  const row = document.createElement('div');
  row.className = 'ctrl-row';
  const lbl = document.createElement('span');
  lbl.className = 'ctrl-label';
  lbl.textContent = 'Sculpt';
  row.appendChild(lbl);
  const group = document.createElement('div');
  group.className = 'seg-group';
  let dir = +1;
  const mk = (label, d) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'seg-btn' + (d === dir ? ' seg-active' : '');
    b.textContent = label;
    b.addEventListener('click', () => {
      dir = d;
      group.querySelectorAll('.seg-btn').forEach((x) => x.classList.remove('seg-active'));
      b.classList.add('seg-active');
      onTool({ mode: 'sculpt', dir, objectId: null });
    });
    return b;
  };
  const raiseBtn = mk('Raise', +1);
  const lowerBtn = mk('Lower', -1);
  group.appendChild(raiseBtn);
  group.appendChild(lowerBtn);
  row.appendChild(group);
  aside.appendChild(row);

  // Object palette: a "Sculpt" (none) chip + one chip per placeable object.
  // Selecting an object switches the tool to place-mode; "Sculpt" returns to
  // sculpt-mode. Right-click always erases (handled in map-view).
  const palRow = document.createElement('div');
  palRow.className = 'ctrl-row';
  const palLbl = document.createElement('span');
  palLbl.className = 'ctrl-label';
  palLbl.textContent = 'Place';
  palRow.appendChild(palLbl);
  const pal = document.createElement('div');
  pal.className = 'seg-group';
  let selected = null; // null = sculpt
  const chips = new Map();
  const select = (objectId) => {
    selected = objectId;
    for (const [id, btn] of chips) btn.classList.toggle('seg-active', id === objectId);
    if (objectId) onTool({ mode: 'place', dir, objectId });
    else onTool({ mode: 'sculpt', dir, objectId: null });
  };
  const chip = (id, label) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'seg-btn';
    b.textContent = label;
    b.addEventListener('click', () => select(id === selected ? null : id));
    chips.set(id, b);
    pal.appendChild(b);
  };
  chip(null, 'Sculpt');
  for (const o of OBJECTS) chip(o.id, o.label);
  palRow.appendChild(pal);
  aside.appendChild(palRow);
  chips.get(null).classList.add('seg-active'); // default to Sculpt

  function reset() {
    // Restore Raise toggle.
    dir = +1;
    raiseBtn.classList.add('seg-active');
    lowerBtn.classList.remove('seg-active');
    // Restore Sculpt palette selection (deselect any object chip).
    selected = null;
    for (const [, btn] of chips) btn.classList.remove('seg-active');
    chips.get(null).classList.add('seg-active');
  }

  return { reset };
}
