// map-edit-controls.js — the Map FOCUS-mode panel, injected into
// <aside id="map-edit-controls">. Mirrors map-controls.js styling (.ctrl-*,
// .seg-*). Phase-1 widgets: a Raise/Lower toggle and a "← Board" exit button.
// (Phase 2 adds the object palette to the same panel.)
//
//   createMapEditControls({ onTool, onExit }) -> { reset }
//     onTool({ mode, dir, objectId })  fires when a widget changes the tool
//     onExit()                          "← Board" clicked
//     reset()                           restores Raise selection (dir=+1), no onTool fired

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

  function reset() {
    dir = +1;
    raiseBtn.classList.add('seg-active');
    lowerBtn.classList.remove('seg-active');
  }

  return { reset };
}
