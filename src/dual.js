// dual.js — dual-cell extraction + point hit-testing. Pure logic, NO DOM.
//
// A dual cell exists for each PRIMARY vertex with >= 3 incident quads (an
// interior vertex). Its polygon is the centroids of the incident quads, sorted
// by angle around the vertex. Boundary vertices (< 3 incident quads) have no
// complete dual cell and are skipped (docs/03 stage 6).
//
// extractDualCells(mesh, halfEdge) -> Array<{ vertexIndex, centroids, center }>
//   centroids: ordered [x,y][] forming the cell polygon (angle-sorted, CCW)
//   center:    the primary vertex position (hit-testing / labels)
// The returned array also carries a `.byVertex` Map (vertexIndex -> cell).
//
// hitTestVertex(point, dualCells) -> vertexIndex | -1
//   point-in-polygon over each cell's centroid polygon. Returns the surrounded
//   primary vertex index of the first containing cell, else -1.

function centroidOfFaceVerts(vertices, vidx) {
  let x = 0, y = 0;
  for (const vi of vidx) {
    x += vertices[vi][0];
    y += vertices[vi][1];
  }
  return [x / vidx.length, y / vidx.length];
}

export function extractDualCells(mesh, halfEdge) {
  const { vertices } = mesh;
  const cells = [];
  const byVertex = new Map();

  for (let v = 0; v < vertices.length; v++) {
    const faces = halfEdge.facesAroundVertex(v);
    if (faces.length < 3) continue; // boundary vertex: no complete dual cell

    const center = vertices[v];
    // centroid of each incident quad
    const centroids = faces.map((f) =>
      centroidOfFaceVerts(vertices, halfEdge.verticesOfFace(f))
    );

    // sort by angle around the vertex -> ordered (CCW) polygon
    centroids.sort(
      (a, b) =>
        Math.atan2(a[1] - center[1], a[0] - center[0]) -
        Math.atan2(b[1] - center[1], b[0] - center[0])
    );

    const cell = { vertexIndex: v, centroids, center };
    cells.push(cell);
    byVertex.set(v, cell);
  }

  cells.byVertex = byVertex;
  return cells;
}

// Standard ray-casting point-in-polygon (even-odd rule).
function pointInPolygon(pt, poly) {
  const [px, py] = pt;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function hitTestVertex(point, dualCells) {
  for (const cell of dualCells) {
    if (pointInPolygon(point, cell.centroids)) return cell.vertexIndex;
  }
  return -1;
}
