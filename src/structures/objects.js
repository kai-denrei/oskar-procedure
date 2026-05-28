// objects.js — placeable-object registry for Map tile editing. Pure: NO DOM/GL.
// make(ctx) returns a record using the SAME schema buildSceneGeometry's
// emitDecorations consumes (so placed objects ride the same VBO + shading),
// tagged with `cell` (the quad it sits on) so its z can follow terrain edits.
//   ctx = { x, y, z, cell, inr }   (inr = cell inradius → keeps objects in-cell)

function makeTree({ x, y, z, cell, inr }) {
  const canopyRadius = inr * 0.7;
  return {
    type: 'tree', cell, x, y, z,
    canopyRadius,
    trunkRadius: canopyRadius * 0.25,
    trunkHeight: canopyRadius * 1.1,
    canopyHeight: canopyRadius * 2.1,
    angle: 0,
  };
}
function makeRock({ x, y, z, cell, inr }) {
  const radius = inr * 0.55;
  return { type: 'rock', cell, x, y, z, radius, height: radius * 0.7 };
}
function makeBuilding({ x, y, z, cell, inr }) {
  const width = inr * 0.95;
  return { type: 'building', cell, x, y, z, width, wallHeight: width * 0.8, roofHeight: width * 0.6 };
}
function makeWater({ x, y, z, cell }) {
  return { type: 'water', cell, quadIndex: cell, z };
}

export const OBJECTS = [
  { id: 'tree', label: 'Tree', make: makeTree },
  { id: 'rock', label: 'Rock', make: makeRock },
  { id: 'building', label: 'Building', make: makeBuilding },
  { id: 'water', label: 'Water', make: makeWater },
];

export function getObjectDef(id) {
  return OBJECTS.find((o) => o.id === id) || null;
}
