// renderer.js — hand-written WebGL2 (fallback WebGL1) renderer for the 3D view.
// One shader program: MVP-transformed positions, per-vertex world normal +
// color, simple Lambert (one directional light + ambient). Depth test + back-
// face culling. DPI-correct viewport + resize. Context-loss handling.
//
//   createRenderer(canvas) -> {
//     ok, isWebGL2,
//     setGeometry(geom),   // upload position/normal/color VBOs + index IBO
//     draw(mvpMatrix),     // clear + draw the uploaded geometry
//     resize(),            // DPI-correct backing store + viewport
//     dispose(),
//   }
//
// Shaders are inline strings (no build step). GLSL is written ES1.00-compatible
// (attribute/varying/gl_FragColor) so the same source compiles under WebGL1 and
// WebGL2 — no #version directive, maximizing reach with one code path.

const VERT_SRC = `
precision highp float;
attribute vec3 aPos;
attribute vec3 aNormal;
attribute vec3 aColor;
uniform mat4 uMVP;
varying vec3 vNormal;
varying vec3 vColor;
void main() {
  vNormal = aNormal;          // already in world space (no non-uniform scale)
  vColor = aColor;
  gl_Position = uMVP * vec4(aPos, 1.0);
}
`;

const FRAG_SRC = `
precision highp float;
varying vec3 vNormal;
varying vec3 vColor;
uniform vec3 uLightDir;   // direction TO the light, normalized
uniform float uAmbient;
void main() {
  vec3 n = normalize(vNormal);
  // two-sided: faces lit regardless of which way the normal points
  float diff = abs(dot(n, normalize(uLightDir)));
  float shade = uAmbient + (1.0 - uAmbient) * diff;
  gl_FragColor = vec4(vColor * shade, 1.0);
}
`;

// House background (--bg #14130f) in 0..1.
const BG = [0x14 / 255, 0x13 / 255, 0x0f / 255];

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('shader compile failed: ' + log);
  }
  return sh;
}

function linkProgram(gl, vsSrc, fsSrc) {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    throw new Error('program link failed: ' + log);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return prog;
}

export function createRenderer(canvas) {
  let gl = null;
  let isWebGL2 = false;
  let prog = null;
  let loc = null;       // attrib/uniform locations
  let buffers = null;   // { pos, normal, color, index, indexCount }
  let pending = null;   // geometry uploaded before GL ready (after context loss)
  let dpr = 1;
  let contextLost = false;

  function initGL() {
    gl = canvas.getContext('webgl2', { antialias: true, depth: true });
    isWebGL2 = !!gl;
    if (!gl) {
      gl = canvas.getContext('webgl', { antialias: true, depth: true })
        || canvas.getContext('experimental-webgl', { antialias: true, depth: true });
    }
    if (!gl) return false;

    prog = linkProgram(gl, VERT_SRC, FRAG_SRC);
    loc = {
      aPos: gl.getAttribLocation(prog, 'aPos'),
      aNormal: gl.getAttribLocation(prog, 'aNormal'),
      aColor: gl.getAttribLocation(prog, 'aColor'),
      uMVP: gl.getUniformLocation(prog, 'uMVP'),
      uLightDir: gl.getUniformLocation(prog, 'uLightDir'),
      uAmbient: gl.getUniformLocation(prog, 'uAmbient'),
    };

    // WebGL1 needs the OES_element_index_uint extension to use Uint32 indices.
    if (!isWebGL2) {
      gl.getExtension('OES_element_index_uint');
    }

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    gl.clearColor(BG[0], BG[1], BG[2], 1);
    return true;
  }

  const okInit = initGL();

  function uploadArray(buf, data) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  }

  function setGeometry(geom) {
    if (!gl || contextLost) {
      pending = geom; // re-upload once context is restored
      return;
    }
    pending = geom; // keep a copy so a later context-restore can re-upload
    if (!geom || !geom.indices || geom.indices.length === 0) {
      buffers = null;
      return;
    }
    if (!buffers) {
      buffers = {
        pos: gl.createBuffer(),
        normal: gl.createBuffer(),
        color: gl.createBuffer(),
        index: gl.createBuffer(),
        indexCount: 0,
      };
    }
    uploadArray(buffers.pos, geom.positions);
    uploadArray(buffers.normal, geom.normals);
    uploadArray(buffers.color, geom.colors);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.index);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geom.indices, gl.STATIC_DRAW);
    buffers.indexCount = geom.indices.length;
  }

  function resize() {
    if (!gl) return;
    dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  function draw(mvp) {
    if (!gl || contextLost) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!buffers || !buffers.indexCount) return;

    gl.useProgram(prog);
    gl.uniformMatrix4fv(loc.uMVP, false, new Float32Array(mvp));
    // Directional light from upper-front-right; normalized.
    const L = [0.4, 0.5, 0.75];
    const ll = Math.hypot(L[0], L[1], L[2]);
    gl.uniform3f(loc.uLightDir, L[0] / ll, L[1] / ll, L[2] / ll);
    gl.uniform1f(loc.uAmbient, 0.38);

    bindAttrib(loc.aPos, buffers.pos, 3);
    bindAttrib(loc.aNormal, buffers.normal, 3);
    bindAttrib(loc.aColor, buffers.color, 3);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.index);
    gl.drawElements(gl.TRIANGLES, buffers.indexCount, gl.UNSIGNED_INT, 0);
  }

  function bindAttrib(location, buf, size) {
    if (location < 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  }

  // --- context loss / restore ---------------------------------------------
  function onLost(e) {
    e.preventDefault(); // signals we intend to restore
    contextLost = true;
    buffers = null;
  }
  function onRestored() {
    contextLost = false;
    if (initGL()) {
      resize();
      if (pending) setGeometry(pending);
    }
  }
  if (canvas && canvas.addEventListener) {
    canvas.addEventListener('webglcontextlost', onLost, false);
    canvas.addEventListener('webglcontextrestored', onRestored, false);
  }

  if (okInit) resize();

  return {
    ok: okInit,
    get isWebGL2() { return isWebGL2; },
    gl,
    setGeometry,
    draw,
    resize,
    dispose() {
      if (canvas && canvas.removeEventListener) {
        canvas.removeEventListener('webglcontextlost', onLost);
        canvas.removeEventListener('webglcontextrestored', onRestored);
      }
    },
  };
}
