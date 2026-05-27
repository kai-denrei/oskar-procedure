// halfedge.js — DCEL (doubly-connected edge list) over a finalized quad mesh.
// Pure logic, NO DOM (Node-testable). Built once after relaxation.
//
// Structure (docs/04):
//   HalfEdge { vertex (origin index), twin, next, face }
//   Vertex   { pos, he }   // he = one outgoing half-edge (origin === this vertex)
//   Face     { he }        // walk he.next x4 to get the quad
//
// For each quad [i0,i1,i2,i3] (CCW) we create 4 directed half-edges along the
// boundary i0->i1->i2->i3->i0. Each half-edge's origin (`vertex`) is its tail.
// Twin matching: the half-edge directed a->b is twinned with the half-edge
// directed b->a on the adjacent face. Boundary half-edges keep twin = null.
//
// Orbit operator for "faces around a vertex" (docs/04): from an outgoing
// half-edge `he` (origin === v), the next outgoing half-edge around v is
// `he.twin.next`:
//   - he goes v -> n
//   - he.twin goes n -> v (origin n), exists only if the edge is interior
//   - he.twin.next goes v -> (the next neighbour) on the twin's face
// Collecting `he.face` at each step enumerates the incident faces. If a twin is
// null we've reached the boundary fan; we then sweep the other direction so the
// full incident-face set is still found.

export function buildHalfEdge(mesh) {
  const { vertices, quads } = mesh;

  const Vertices = vertices.map((pos) => ({ pos, he: null }));
  const Faces = [];
  const halfEdges = [];

  // directed edge "a->b" -> the half-edge with that origin->head, for twin matching.
  const directed = new Map();
  const dkey = (a, b) => a + '->' + b;

  // outgoing[v] = every half-edge originating at v (used to enumerate disjoint
  // fans at rare non-manifold "pinch" vertices — see facesAroundVertex).
  const outgoing = vertices.map(() => []);

  for (let qi = 0; qi < quads.length; qi++) {
    const q = quads[qi];
    const face = { he: null };
    Faces.push(face);

    // create the 4 half-edges for this quad, origins = q[0..3]
    const ring = [];
    for (let i = 0; i < 4; i++) {
      const he = { vertex: q[i], twin: null, next: null, face };
      ring.push(he);
      halfEdges.push(he);
    }
    // link next cyclically: he[i] goes q[i] -> q[i+1]
    for (let i = 0; i < 4; i++) ring[i].next = ring[(i + 1) % 4];
    face.he = ring[0];

    // register directed edges and set a representative outgoing he per vertex
    for (let i = 0; i < 4; i++) {
      const a = q[i];
      const b = q[(i + 1) % 4];
      directed.set(dkey(a, b), ring[i]);
      outgoing[a].push(ring[i]);
      if (Vertices[a].he === null) Vertices[a].he = ring[i];
    }
  }

  // twin matching: a->b twins with b->a
  for (let qi = 0; qi < quads.length; qi++) {
    const q = quads[qi];
    const base = qi * 4;
    for (let i = 0; i < 4; i++) {
      const he = halfEdges[base + i];
      if (he.twin !== null) continue;
      const a = q[i];
      const b = q[(i + 1) % 4];
      const back = directed.get(dkey(b, a));
      if (back) {
        he.twin = back;
        back.twin = he;
      }
      // else: boundary half-edge, twin stays null
    }
  }

  // verticesOfFace(face) — walk f.he.next x4, return the 4 origin vertex indices.
  function verticesOfFace(face) {
    const out = [];
    let e = face.he;
    for (let i = 0; i < 4; i++) {
      out.push(e.vertex);
      e = e.next;
    }
    return out;
  }

  // facesAroundVertex(v) — collect incident faces by orbiting outgoing half-edges.
  // Forward orbit: he -> he.twin.next (counter-clockwise about v). Stops on a null
  // twin (boundary). For boundary vertices we then sweep the other way from the
  // start so the full incident-face set is returned regardless of direction.
  function facesAroundVertex(v) {
    const start = Vertices[v].he;
    if (!start) return [];
    const faces = [];
    const seen = new Set();

    const add = (f) => {
      if (!seen.has(f)) {
        seen.add(f);
        faces.push(f);
      }
    };

    // Traverse one connected fan from an outgoing half-edge `s` (origin v).
    // Forward orbit (CCW about v): next outgoing half-edge is e.twin.next. Stops
    // on a null twin (boundary) or when it returns to s (closed interior fan).
    // If it didn't close, v is on a boundary fan: also sweep the other way from s
    // so the whole fan is captured regardless of where s sits in it. Reverse
    // step: prev = predecessor of r in r's own quad ring (prev.next === r); prev's
    // head is v, so prev.twin (if interior) is the previous outgoing half-edge.
    const walkFan = (s) => {
      let e = s;
      let closed = false;
      for (let guard = 0; guard < halfEdges.length + 4; guard++) {
        add(e.face);
        if (!e.twin) break;
        e = e.twin.next;
        if (e === s) { closed = true; break; }
      }
      if (!closed) {
        let r = s;
        for (let guard = 0; guard < halfEdges.length + 4; guard++) {
          const prev = r.next.next.next; // ring of 4: predecessor of r
          if (!prev.twin) break;
          r = prev.twin;
          if (r === s) break;
          add(r.face);
        }
      }
    };

    walkFan(start);

    // Most vertices are manifold: the single fan covers all incident faces. At
    // rare non-manifold "pinch" vertices the incident quads split into >1 fan
    // (quads meeting only at the point, not along an edge). Pick up any fan not
    // yet visited so the full incident-face set is always returned.
    for (const he of outgoing[v]) {
      if (!seen.has(he.face)) walkFan(he);
    }

    return faces;
  }

  return {
    halfEdges,
    vertices: Vertices,
    faces: Faces,
    facesAroundVertex,
    verticesOfFace,
  };
}
