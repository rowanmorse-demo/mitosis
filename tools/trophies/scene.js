// Rank art in 3D (three.js): nine trophies (the Profile) and nine crests (the rank badges), one of each per ladder step, in
// the step's colours from index.html RANK_STEPS. Runs in render.html; render.js drives it and bakes the pictures into index.html.
// Both are built from one kit so they read as a family: polished metal in the step's colour, dark glossy enamel, cut gems,
// and the step's cell as a bold glowing enamel symbol (the same symbol on the crest and inside the trophy's glass orb).
// The extras climb with the ladder: studs, a top gem, laurels, blades, wings, rings, a crown, and for Mitosis iridescent
// white gold with a sunburst (crest) or a halo (trophy).
'use strict';
(function () {
  const T = THREE;
  const STEPS = [ // keep in step with RANK_STEPS in index.html
    { key: 'amoeba', pal: ['#ffd9b5', '#c9854f', '#4f260c'] },
    { key: 'colony', pal: ['#ffffff', '#a9b8c7', '#344150'] },
    { key: 'interphase', pal: ['#fff1b8', '#f2b134', '#6e3f02'] },
    { key: 'prophase', pal: ['#e2fffb', '#55d0c9', '#0f4f50'] },
    { key: 'metaphase', pal: ['#e3ecff', '#5b8cff', '#16307a'] },
    { key: 'anaphase', pal: ['#efe3ff', '#a070ff', '#2a0d66'] },
    { key: 'telophase', pal: ['#ffe0e6', '#ff4d6d', '#5c0a1c'] },
    { key: 'cytokinesis', pal: ['#ffeedd', '#ff8a3d', '#5c2204'] },
    { key: 'mitosis', pal: ['#fff6d6', '#ffd36b', '#3a2408'] }];
  const ORB = { y: 3.7, r: 0.76 };
  const C = h => new T.Color(h), V2 = (x, y) => new T.Vector2(x, y), V3 = (x, y, z) => new T.Vector3(x, y, z);

  function materials(fi) {
    const p = STEPS[fi].pal, top = fi === 8;
    const metal = new T.MeshPhysicalMaterial({ color: C(p[1]), metalness: 1, roughness: 0.22, clearcoat: 0.6, clearcoatRoughness: 0.1, envMapIntensity: 1.05 });
    if (top) Object.assign(metal, { color: C('#ffc94a'), iridescence: 0.45, iridescenceIOR: 1.6 });
    const bright = metal.clone(); bright.color = (top ? C('#ffe7a6') : C(p[0]).lerp(C(p[1]), 0.45)); bright.roughness = 0.16;
    const deep = metal.clone(); deep.color = C(p[2]).lerp(C(p[1]), 0.42); deep.roughness = 0.3;
    const stone = new T.MeshPhysicalMaterial({ color: C('#0b1112').lerp(C(p[2]), 0.28), metalness: 0.2, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06, flatShading: true, envMapIntensity: 1.1 });
    const field = new T.MeshPhysicalMaterial({ color: C('#03080a').lerp(C(p[2]), 0.42), metalness: 0.3, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 0.8 });
    const gem = new T.MeshPhysicalMaterial({ color: C(p[1]).lerp(C('#ffffff'), 0.15), metalness: 0, roughness: 0.03, ior: 2.3, specularIntensity: 1, clearcoat: 1, emissive: C(p[1]), emissiveIntensity: 0.45, flatShading: true, envMapIntensity: 2 });
    // the cell symbol: glossy, faintly glowing enamel (hi), a deeper tone for membranes and fibres (mid), dark for nuclei on light (lo)
    const hi = new T.MeshPhysicalMaterial({ color: C(p[0]).lerp(C(p[1]), 0.22), emissive: C(p[0]).lerp(C(p[1]), 0.4), emissiveIntensity: 0.32, metalness: 0.1, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.1 });
    const mid = hi.clone(); mid.color = C(p[1]).lerp(C(p[0]), 0.25); mid.emissive = C(p[1]); mid.emissiveIntensity = 0.22;
    const lo = new T.MeshPhysicalMaterial({ color: C(p[2]).lerp(C('#000000'), 0.15), metalness: 0.2, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.04 });
    const inside = new T.MeshStandardMaterial({ color: C(p[2]).multiplyScalar(0.22), emissive: C(p[2]), emissiveIntensity: 0.2, roughness: 1, side: T.BackSide });
    // glass: only its reflections show (added over the dark orb), so the symbol glows through clear glass
    const glass = new T.MeshPhysicalMaterial({ color: C('#000000'), metalness: 0, roughness: 0.02, clearcoat: 1, clearcoatRoughness: 0, specularIntensity: 1, ior: 1.6, envMapIntensity: 1.0, transparent: true, blending: T.AdditiveBlending, depthWrite: false });
    const halo = new T.MeshStandardMaterial({ color: C('#ffe7a0'), emissive: C('#ffcf5a'), emissiveIntensity: 1.1, roughness: 0.25, metalness: 0.3 });
    return { p, top, metal, bright, deep, stone, field, gem, hi, mid, lo, inside, glass, halo };
  }
  const glowOf = (mesh, color, k) => { mesh.userData.glow = [C(color), k]; return mesh; };

  /* ---------- shapes ---------- */
  const circle = (x, y, r) => { const s = new T.Shape(); s.absarc(x, y, r, 0, Math.PI * 2, false); return s; };
  const holeC = (x, y, r) => { const h = new T.Path(); h.absarc(x, y, r, 0, Math.PI * 2, true); return h; };
  const ring = (x, y, R, r) => { const s = circle(x, y, R); s.holes.push(holeC(x, y, r)); return s; };
  const pill = (x1, y1, x2, y2, r) => { const a = Math.atan2(y2 - y1, x2 - x1), s = new T.Shape(); s.absarc(x2, y2, r, a - Math.PI / 2, a + Math.PI / 2, false); s.absarc(x1, y1, r, a + Math.PI / 2, a + Math.PI * 1.5, false); s.closePath(); return s; };
  const poly = pts => { const s = new T.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (const q of pts.slice(1)) s.lineTo(q[0], q[1]); s.closePath(); return s; };
  function lathe(pts, mat, seg = 64) { return new T.Mesh(new T.LatheGeometry(pts.map(([r, y]) => V2(r, y)), seg, seg === 8 ? Math.PI / 8 : 0), mat); }
  function tube(points, r, mat, closed = false) { return new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(points.map(a => V3(...a)), closed), 48, r, 10, closed), mat); }
  function extrude(shape, depth, bevel, mat, centre = true) {
    const g = new T.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.85, bevelSegments: 4, curveSegments: 40 });
    if (centre) g.translate(0, 0, -depth / 2); g.computeVertexNormals(); return new T.Mesh(g, mat);
  }
  function gemMesh(m, sx, sy, sz) { const g = new T.Mesh(new T.OctahedronGeometry(1, 0), m.gem); g.scale.set(sx, sy, sz); return glowOf(g, m.p[1], 0.35); }
  function setGem(m, parent, x, y, z, s) { // a cut gem in a metal bezel
    const b = new T.Mesh(new T.TorusGeometry(s * 1.05, s * 0.28, 10, 32), m.bright); b.position.set(x, y, z); parent.add(b);
    const g = gemMesh(m, s, s * 1.12, s * 0.62); g.position.set(x, y, z + s * 0.2); g.rotation.z = Math.PI / 4; parent.add(g); return g;
  }

  /* ---------- the cell symbol of each step: about 2 units across, facing +z, sitting on z = 0 ---------- */
  function emblem(key, m, glow = 0.3) {
    const g = new T.Group(), parts = [];
    const add = (shape, tone = 'hi', o = {}) => parts.push({ shape, tone, z: o.z || 0, bevel: o.bevel ?? 0.07, depth: o.depth ?? 0.12 });
    switch (key) {
      case 'amoeba': { const pts = []; for (let i = 0; i < 120; i++) { const t = i / 120 * Math.PI * 2, r = 0.7 + 0.24 * Math.pow(Math.max(0, Math.sin(3 * t + 0.6)), 2) + 0.12 * Math.sin(5 * t + 1.9) + 0.06 * Math.sin(2 * t); pts.push([r * Math.cos(t), r * Math.sin(t) * 0.92]); }
        add(poly(pts)); add(circle(-0.12, 0.1, 0.22), 'lo', { z: 0.1 }); add(circle(0.3, -0.24, 0.1), 'mid', { z: 0.08 }); break; }
      case 'colony': [[0, 0.44, 0.06], [-0.44, 0, 0.03], [0.44, 0, 0.03], [0, -0.44, 0]].forEach(([x, y, z]) => { add(circle(x, y, 0.41), 'hi', { z }); add(circle(x + 0.05, y + 0.04, 0.14), 'lo', { z: z + 0.1 }); }); break;
      case 'interphase': { add(circle(0, 0, 0.9)); add(circle(0.06, 0.05, 0.5), 'lo', { z: 0.1 }); // a resting cell: its nucleus, with the chromosome thread loose inside
        const w = []; for (let i = 0; i <= 8; i++) { const x = -0.3 + i * 0.075; w.push([x + 0.06, 0.05 + 0.14 * Math.sin(i * 1.5)]); } for (let i = 0; i < 8; i++) add(pill(w[i][0], w[i][1], w[i + 1][0], w[i + 1][1], 0.08), 'hi', { z: 0.3 + i * 0.002, bevel: 0.03, depth: 0.05 }); break; }
      case 'prophase': add(ring(0, 0, 0.94, 0.78), 'mid'); add(pill(-0.36, -0.5, 0.36, 0.5, 0.16)); add(pill(0.36, -0.5, -0.36, 0.5, 0.16), 'hi', { z: 0.01 }); add(circle(0, 0, 0.13), 'lo', { z: 0.1 }); break;
      case 'metaphase': add(ring(0, 0, 0.94, 0.79), 'mid');
        for (const x of [-0.6, 0.6]) { add(circle(x, 0, 0.11)); for (const y of [-0.34, 0, 0.34]) add(pill(x, 0, x * 0.35, y, 0.035), 'mid', { bevel: 0.02, depth: 0.04 }); }
        for (const y of [-0.34, 0, 0.34]) add(pill(-0.21, y, 0.21, y, 0.12), 'hi', { z: 0.03 }); break;
      case 'anaphase': { const s = pill(-0.42, 0, 0.42, 0, 0.56), h = new T.Path(pill(-0.42, 0, 0.42, 0, 0.42).getPoints(48)); s.holes.push(h); add(s, 'mid');
        for (const sx of [-1, 1]) { add(pill(sx * 0.2, 0.27, sx * 0.5, 0, 0.1)); add(pill(sx * 0.2, -0.27, sx * 0.5, 0, 0.1), 'hi', { z: 0.01 }); add(circle(sx * 0.74, 0, 0.08)); } add(pill(-0.06, 0, 0.06, 0, 0.035), 'mid', { bevel: 0.02, depth: 0.04 }); break; }
      case 'telophase': { const R = 0.5, cx = 0.43, an = Math.atan2(Math.sqrt(R * R - cx * cx), -cx), sh = new T.Shape(); // one cell pinching in two
        sh.absarc(cx, 0, R, an, -an, true); sh.absarc(-cx, 0, R, -(Math.PI - an), Math.PI - an, true); sh.closePath();
        const tilt = q => { const c = Math.cos(0.62), si = Math.sin(0.62); return V2(q.x * c - q.y * si, q.x * si + q.y * c); };
        add(new T.Shape(sh.getPoints(80).map(tilt))); for (const sx of [-1, 1]) { const n = tilt(V2(sx * 0.52, 0)); add(circle(n.x, n.y, 0.17), 'lo', { z: 0.1 }); }
        const f1 = tilt(V2(0, 0.36)), f2 = tilt(V2(0, -0.36)); add(pill(f1.x, f1.y, f2.x, f2.y, 0.03), 'lo', { z: 0.1, bevel: 0.02, depth: 0.04 }); break; }
      case 'cytokinesis': for (const sx of [-1, 1]) { add(circle(sx * 0.45, sx * 0.33, 0.44)); add(circle(sx * 0.55, sx * 0.42, 0.15), 'lo', { z: 0.1 }); } add(pill(-0.12, -0.09, 0.12, 0.09, 0.06), 'mid'); break; // two cells parting
      case 'mitosis': { for (const sx of [-1, 1]) { add(circle(sx * 0.48, -sx * 0.34, 0.4)); add(circle(sx * 0.58, -sx * 0.42, 0.14), 'lo', { z: 0.1 }); } // two daughters and the spark between them
        const st = []; for (let i = 0; i < 8; i++) { const an = Math.PI / 2 + i * Math.PI / 4, r = i % 2 ? 0.12 : 0.46; st.push([r * Math.cos(an), r * Math.sin(an)]); } add(poly(st), 'star', { z: 0.12 }); break; }
    }
    for (const q of parts) {
      const geo = new T.ExtrudeGeometry(q.shape, { depth: q.depth, bevelEnabled: true, bevelThickness: q.bevel, bevelSize: q.bevel * 0.8, bevelSegments: 4, curveSegments: 40 });
      const mesh = new T.Mesh(geo, q.tone === 'star' ? m.halo : m[q.tone]); mesh.position.z = q.z + q.bevel;
      if (q.tone === 'hi') glowOf(mesh, m.p[0], glow); else if (q.tone === 'mid') glowOf(mesh, m.p[1], glow * 0.6); else if (q.tone === 'star') glowOf(mesh, '#fff2b8', glow * 2.6);
      g.add(mesh);
    }
    return g;
  }

  /* ---------- crests ---------- */
  function shield() {
    const s = new T.Shape(); s.moveTo(-0.86, 0.9); s.quadraticCurveTo(-0.43, 0.98, 0, 0.84); s.quadraticCurveTo(0.43, 0.98, 0.86, 0.9);
    s.lineTo(0.86, 0.12); s.quadraticCurveTo(0.84, -0.6, 0, -1.08); s.quadraticCurveTo(-0.84, -0.6, -0.86, 0.12); s.closePath(); return s;
  }
  const scaled = (pts, k, dy) => pts.map(q => V2(q.x * k, q.y * k + dy));
  function feather(len, w, mat, bend, thick = 0.05) { // a broad blade with a rounded tip, bent along its length
    const f = new T.Shape(); f.moveTo(0, -w * 0.45); f.quadraticCurveTo(len * 0.6, -w * 0.75, len * 0.97, -w * 0.12); f.quadraticCurveTo(len * 1.02, w * 0.2, len * 0.86, w * 0.42); f.quadraticCurveTo(len * 0.45, w * 0.7, 0, w * 0.45); f.closePath();
    const fe = extrude(f, thick, thick * 0.7, mat), pos = fe.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) { const u = Math.max(0, pos.getX(i) / len); pos.setY(i, pos.getY(i) - bend * len * u * u); pos.setZ(i, pos.getZ(i) - 0.12 * len * u * u); }
    fe.geometry.computeVertexNormals(); return fe;
  }
  const leafShape = (() => { const l = new T.Shape(); l.moveTo(0, 0); l.quadraticCurveTo(0.17, 0.15, 0.4, 0); l.quadraticCurveTo(0.17, -0.15, 0, 0); return l; })();

  function buildCrest(fi) {
    const m = materials(fi), root = new T.Group(), pts = shield().getPoints(80);
    const field = new T.Shape(scaled(pts, 0.84, -0.025)), inner = new T.Path(scaled(pts, 0.8, -0.03)), rim = new T.Shape(pts.map(q => q.clone())); rim.holes.push(inner);
    const back = extrude(new T.Shape(pts.map(q => q.clone())), 0.1, 0.04, m.deep, false); back.position.z = -0.24; root.add(back); // back plate
    const f = extrude(field, 0.06, 0.02, m.field, false); f.position.z = -0.1; root.add(f);                                 // dark enamel field, top at 0
    const r = extrude(rim, 0.12, 0.085, m.metal, false); r.position.z = -0.07; root.add(r);                                // a chunky rounded rim, top at about .14
    const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64), col = C(m.p[1]);
      const rgb = a => `rgba(${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)},${a})`; g.addColorStop(0, rgb(0.55)); g.addColorStop(0.5, rgb(0.18)); g.addColorStop(1, rgb(0)); x.fillStyle = g; x.fillRect(0, 0, 128, 128);
      const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t; })();
    const light = new T.Mesh(new T.PlaneGeometry(1.5, 1.5), new T.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false })); light.position.set(0, 0.13, 0.004); root.add(light);
    const e = emblem(STEPS[fi].key, m, 0.32); e.scale.setScalar(0.47); e.position.set(0, 0.13, 0); root.add(e);
    // the division: where rankBadge sets 1-3 gems over the picture (only those earned show); Mitosis has one great gem instead
    const sockets = fi < 8 ? [[-0.31, -0.5], [0, -0.66], [0.31, -0.5]].map(([x, y]) => V3(x, y, 0.1)) : [];
    if (fi === 8) setGem(m, root, 0, -0.52, 0.05, 0.13);
    // studs on the rim (Colony up), a gem at the top (Interphase up)
    if (fi >= 1) for (const sx of [-1, 1]) for (const [x, y] of [[0.775, 0.79], [0.775, 0.09], [0.54, -0.545]]) { const s = new T.Mesh(new T.SphereGeometry(0.045, 16, 12), m.bright); s.position.set(sx * x, y, 0.15); root.add(s); }
    if (fi >= 2) setGem(m, root, 0, 0.75, 0.15, 0.085);
    // laurel sprigs up the sides (Prophase, Metaphase)
    if (fi === 3 || fi === 4) for (const sgn of [-1, 1]) {
      const arc = []; for (let d = 0; d <= 1.001; d += 0.1) { const t = -1.35 + d * 2.1; arc.push([sgn * 1.0 * Math.cos(t), 0.05 + 1.08 * Math.sin(t), -0.3]); }
      root.add(tube(arc, 0.03, m.deep));
      for (let i = 1; i < arc.length - 1; i++) { const [x, y] = arc[i], [x2, y2] = arc[i + 1], tang = Math.atan2(y2 - y, x2 - x);
        for (const o of [-1, 1]) { const l = extrude(leafShape, 0.03, 0.02, i % 2 ? m.metal : m.bright); l.scale.setScalar(0.62); l.position.set(x, y, -0.28); l.rotation.z = tang + o * 0.75; root.add(l); } }
    }
    // blades out from the shoulders (Metaphase)
    if (fi === 4) for (const sgn of [-1, 1]) { const b = new T.Shape(); b.moveTo(0, -0.1); b.quadraticCurveTo(0.3, -0.06, 0.62, 0.16); b.quadraticCurveTo(0.3, 0.1, 0, 0.12); b.closePath();
      const bl = extrude(b, 0.05, 0.03, m.bright); bl.position.set(sgn * 0.7, 0.28, -0.2); bl.scale.y = 0.9; bl.scale.x = sgn; bl.rotation.z = sgn * -0.12; root.add(bl); }
    // wings (Anaphase up)
    if (fi >= 5) { const big = fi >= 7 ? 1.0 : 0.92;
      for (const sgn of [-1, 1]) { const side = new T.Group(); side.position.set(sgn * 0.62, 0.36, -0.32); side.rotation.y = sgn * 0.35; side.scale.x = sgn; root.add(side);
        for (let i = 0; i < 6; i++) { const fe = feather((0.5 + i * 0.07) * big, 0.21, i % 2 ? m.metal : m.top ? m.bright : m.deep, 0.16, 0.035); fe.rotation.z = (-42 + i * 15) * Math.PI / 180; fe.position.set(0.01 * i, -0.2 + i * 0.07, -0.03 * i); side.add(fe); }
        for (let i = 0; i < 4; i++) { const fe = feather((0.32 + i * 0.05) * big, 0.18, m.bright, 0.1, 0.035); fe.rotation.z = (-30 + i * 19) * Math.PI / 180; fe.position.set(0, -0.12 + i * 0.06, 0.08); side.add(fe); } } }
    // a spire at the top (Telophase), a crown (Cytokinesis up)
    if (fi === 6) { root.add(lathe([[0, 0.86], [0.16, 0.86], [0.18, 0.9], [0.1, 0.96], [0, 0.97]], m.bright, 48)); const g = gemMesh(m, 0.13, 0.2, 0.09); g.position.set(0, 1.16, 0.02); root.add(g); }
    if (fi >= 7) { const c = new T.Group(); c.position.set(0, 0.9, -0.02); root.add(c);
      c.add(lathe([[0.25, 0], [0.29, 0.02], [0.3, 0.12], [0.26, 0.14], [0.23, 0.02]], m.metal, 64));
      for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2 + Math.PI / 14, sp = new T.Mesh(new T.ConeGeometry(0.055, i % 2 ? 0.2 : 0.3, 8), m.metal); sp.position.set(0.28 * Math.sin(a), 0.24, 0.28 * Math.cos(a)); sp.rotation.set(Math.cos(a) * 0.25, 0, -Math.sin(a) * 0.25); c.add(sp);
        const tip = new T.Mesh(new T.SphereGeometry(0.04, 12, 10), m.bright); tip.position.set(0.31 * Math.sin(a), i % 2 ? 0.36 : 0.41, 0.31 * Math.cos(a)); c.add(tip); } }
    // a sunburst behind it all (Mitosis)
    if (fi === 8) { const g = new T.Group(); g.position.set(0, 0.1, -0.45); root.add(g);
      for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2, long = i % 2 === 0, sp = new T.Shape(); sp.moveTo(0, -0.12); sp.lineTo(long ? 1.34 : 1.12, 0); sp.lineTo(0, 0.12); sp.closePath();
        const ray = extrude(sp, 0.02, 0.015, long ? m.bright : m.metal); ray.rotation.z = a; g.add(ray); } }
    root.rotation.x = -0.14; root.updateMatrixWorld(true); for (const v of sockets) v.applyMatrix4(root.matrixWorld);
    return { root, m, sockets };
  }

  /* ---------- trophies ---------- */
  function plinth(m, fi, root) {
    root.add(lathe([[0, 0], [1.34, 0], [1.4, 0.06], [1.4, 0.27], [1.33, 0.34], [0, 0.34]], m.stone, 8));
    root.add(lathe([[0, 0.33], [1.2, 0.33], [1.25, 0.37], [1.25, 0.44], [1.2, 0.48], [0, 0.48]], m.metal, 8));
    root.add(lathe([[0, 0.47], [1.06, 0.47], [1.1, 0.52], [0.93, 1.06], [0.87, 1.11], [0, 1.11]], m.stone, 8));
    root.add(lathe([[0, 1.1], [0.92, 1.1], [0.96, 1.14], [0.96, 1.2], [0.9, 1.25], [0, 1.25]], m.metal, 8));
    // plaque on the slanted front face, with a cabochon (a cut gem from Interphase up)
    const face = new T.Group(); face.position.set(0, 0.79, 0.945); face.rotation.x = -0.272; root.add(face);
    const s = new T.Shape(), w = 0.52, h = 0.19, r = 0.07; s.moveTo(-w + r, -h); s.lineTo(w - r, -h); s.quadraticCurveTo(w, -h, w, -h + r); s.lineTo(w, h - r); s.quadraticCurveTo(w, h, w - r, h); s.lineTo(-w + r, h); s.quadraticCurveTo(-w, h, -w, h - r); s.lineTo(-w, -h + r); s.quadraticCurveTo(-w, -h, -w + r, -h);
    face.add(extrude(s, 0.03, 0.025, m.bright));
    const inset = extrude(new T.Shape(s.getPoints(24).map(q => V2(q.x * 0.82, q.y * 0.7))), 0.02, 0.01, m.stone); inset.position.z = 0.035; face.add(inset);
    if (fi >= 2) { const g = gemMesh(m, 0.11, 0.11, 0.06); g.position.z = 0.07; g.rotation.z = Math.PI / 4; face.add(g);
      for (const x of [-0.3, 0.3]) { const d = gemMesh(m, 0.05, 0.05, 0.03); d.position.set(x, 0, 0.06); face.add(d); } }
    else { const cab = glowOf(new T.Mesh(new T.SphereGeometry(0.085, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), m.gem), m.p[1], 0.3); cab.rotation.x = Math.PI / 2; cab.position.z = 0.045; cab.scale.set(1, 0.6, 1); face.add(cab); }
    if (fi >= 4) for (const sgn of [-1, 1]) { // blade fins on the plinth's sides (Metaphase up)
      const f = new T.Shape(); f.moveTo(0, -0.22); f.quadraticCurveTo(0.35, -0.12, 0.62, 0.34); f.quadraticCurveTo(0.3, 0.12, 0, 0.2); f.closePath();
      const fin = extrude(f, 0.06, 0.03, m.metal); fin.position.set(sgn * 0.98, 0.8, 0.1); fin.scale.x = sgn; fin.rotation.y = sgn * 0.25; root.add(fin);
    }
  }
  function cup(m, fi, root) {
    root.add(lathe([[0, 1.24], [0.56, 1.24], [0.6, 1.29], [0.46, 1.37], [0.27, 1.52], [0.2, 1.72], [0.25, 1.83], [0.37, 1.9], [0.4, 1.96], [0.32, 2.03], [0.2, 2.1], [0.17, 2.2], [0.21, 2.3], [0.3, 2.37], [0, 2.4]], m.metal));
    if (fi >= 2) { const g = gemMesh(m, 0.09, 0.1, 0.06); g.position.set(0, 1.94, 0.41); root.add(g); }
    root.add(lathe([[0, 2.32], [0.3, 2.34], [0.58, 2.45], [0.84, 2.64], [1.0, 2.86], [1.07, 3.04], [1.1, 3.14], [1.18, 3.19], [1.19, 3.24], [1.1, 3.27], [1.02, 3.17], [0.92, 2.94], [0.62, 2.68], [0, 2.6]], m.metal, 96));
    const band = new T.Mesh(new T.TorusGeometry(0.93, 0.045, 12, 96), m.bright); band.rotation.x = Math.PI / 2; band.position.y = 2.73; root.add(band);
    const band2 = new T.Mesh(new T.TorusGeometry(1.155, 0.03, 10, 96), m.bright); band2.rotation.x = Math.PI / 2; band2.position.y = 3.2; root.add(band2);
    if (fi >= 2) { const g = gemMesh(m, 0.12, 0.15, 0.07); g.position.set(0, 2.88, 1.02); g.rotation.x = -0.45; root.add(g); }
    if (fi >= 1) for (const sgn of [-1, 1]) { // handles (Colony up); scrolled ends from Metaphase up
      root.add(tube([[1.02, 3.0, 0], [1.38, 3.06, 0], [1.6, 2.86, 0], [1.56, 2.56, 0], [1.3, 2.42, 0], [0.86, 2.48, 0]].map(([x, y, z]) => [sgn * x, y, z]), 0.075, m.metal));
      if (fi >= 4) { const sc = []; for (let i = 0; i <= 24; i++) { const a = i / 24 * Math.PI * 1.7, rr = 0.2 * (1 - i / 34); sc.push([sgn * (1.46 + rr * Math.cos(a)), 3.12 + rr * Math.sin(a), 0]); } root.add(tube(sc, 0.04, m.bright)); }
    }
  }
  function orb(m, fi, root) { // a dark glass orb with the step's symbol glowing inside, held by four prongs
    const o = new T.Group(); o.position.y = ORB.y; root.add(o);
    o.add(new T.Mesh(new T.SphereGeometry(ORB.r * 0.985, 48, 32), m.inside));
    const e = emblem(STEPS[fi].key, m, 0.6); e.scale.setScalar(ORB.r * 0.7); e.position.z = -0.08; o.add(e);
    const g = new T.Mesh(new T.SphereGeometry(ORB.r, 64, 48), m.glass); g.renderOrder = 5; o.add(g);
    o.add(new T.PointLight(C(m.p[1]), 4, 3, 1.6));
    for (const a of [Math.PI / 4, 3 * Math.PI / 4, -Math.PI / 4, -3 * Math.PI / 4]) {
      const at = (r, y) => [r * Math.sin(a), y, r * Math.cos(a)], top = ORB.y + ORB.r * 0.7;
      root.add(tube([at(1.12, 3.22), at(1.04, 3.5), at(0.86, 3.95), at(0.5, top)], 0.05, m.bright));
      const tip = new T.Mesh(new T.SphereGeometry(0.07, 16, 12), m.bright); tip.position.set(...at(0.5, top)); root.add(tip);
    }
  }
  function laurel(m, fi, root) { // a wreath of metal leaves behind the cup (Prophase, Metaphase)
    const cy = 3.05, R = 1.62, z = -0.5, from = -100, to = 30;
    for (const sgn of [-1, 1]) {
      const arc = []; for (let d = from; d <= to + 0.1; d += 8) { const t = d * Math.PI / 180; arc.push([sgn * R * Math.cos(t), cy + R * Math.sin(t), z]); }
      root.add(tube(arc, 0.05, m.deep));
      for (let d = from + 10; d <= to; d += 14) { const t = d * Math.PI / 180;
        for (const o of [-1, 1]) { const l = extrude(leafShape, 0.04, 0.03, (d / 14) % 2 ? m.metal : m.bright); l.position.set(sgn * R * Math.cos(t), cy + R * Math.sin(t), z + 0.02);
          const tang = t + Math.PI / 2; l.rotation.z = sgn > 0 ? tang + o * 0.6 : Math.PI - tang - o * 0.6; root.add(l); } }
    }
  }
  function wings(m, fi, root) { // feathered wings sweeping out and back from behind the cup (Anaphase up)
    const big = fi >= 7 ? 1.15 : fi >= 6 ? 1.07 : 1;
    for (const sgn of [-1, 1]) {
      const side = new T.Group(); side.position.set(sgn * 0.62, 3.1, -0.62); side.rotation.y = sgn * 0.62; side.scale.x = sgn; root.add(side);
      for (let i = 0; i < 7; i++) { const fe = feather((1.05 + i * 0.2) * big, 0.32, i % 2 ? m.metal : m.top ? m.bright : m.deep, 0.15); fe.rotation.z = (-12 + i * 15.5) * Math.PI / 180; fe.position.set(0.02 * i, -0.3 + i * 0.08, -0.05 * i); side.add(fe); }
      for (let i = 0; i < 5; i++) { const fe = feather((0.6 + i * 0.1) * big, 0.27, m.bright, 0.12); fe.rotation.z = (-8 + i * 21) * Math.PI / 180; fe.position.set(0, -0.18 + i * 0.07, 0.12); side.add(fe); }
    }
  }
  function rings(m, fi, root) { // orbit rings around the orb (Telophase up)
    for (let i = 0; i < (fi >= 7 ? 2 : 1); i++) { const R = ORB.r + 0.32 + i * 0.08, r = new T.Mesh(new T.TorusGeometry(R, 0.04, 12, 120), m.bright); r.position.y = ORB.y; r.rotation.set(Math.PI / 2 - 0.32, 0, i ? -0.42 : 0.36); root.add(r);
      const bead = glowOf(new T.Mesh(new T.SphereGeometry(0.06, 16, 12), m.hi), m.p[0], 1); const a = i ? 2.2 : -0.6; bead.position.set(R * Math.cos(a), R * Math.sin(a), 0); r.add(bead); }
  }
  function crown(m, fi, root) { // above the orb (Cytokinesis up), and a halo for Mitosis
    const c = new T.Group(); c.position.y = ORB.y + ORB.r - 0.06; root.add(c);
    c.add(lathe([[0.36, 0], [0.42, 0.02], [0.44, 0.17], [0.39, 0.19], [0.34, 0.02]], m.metal, 64));
    for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2 + Math.PI / 14, sp = new T.Mesh(new T.ConeGeometry(0.075, i % 2 ? 0.28 : 0.4, 8), m.metal); sp.position.set(0.41 * Math.sin(a), 0.32, 0.41 * Math.cos(a)); sp.rotation.set(Math.cos(a) * 0.25, 0, -Math.sin(a) * 0.25); c.add(sp);
      const tip = new T.Mesh(new T.SphereGeometry(0.055, 12, 10), m.bright); tip.position.set(0.45 * Math.sin(a), i % 2 ? 0.48 : 0.55, 0.45 * Math.cos(a)); c.add(tip); }
    const g = gemMesh(m, 0.08, 0.09, 0.045); g.position.set(0, 0.1, 0.44); c.add(g);
    if (fi === 8) { const h = glowOf(new T.Mesh(new T.TorusGeometry(0.62, 0.065, 16, 96), m.halo), '#ffd36b', 0.8); h.position.y = 1.0; h.rotation.x = Math.PI / 2 - 0.42; c.add(h); }
  }
  function shards(root) { // Mitosis: prism shards floating around
    const cols = ['#ff8ab0', '#a98bff', '#6fe3dc', '#ffe58f', '#ff8ab0', '#6fe3dc'], at = [[-1.75, 4.25, 0.2], [1.8, 4.05, 0.1], [-1.95, 2.35, 0.3], [1.95, 2.55, 0.3], [-1.2, 4.95, -0.2], [1.25, 5.0, -0.2]];
    at.forEach(([x, y, z], i) => { const g = new T.Mesh(new T.OctahedronGeometry(1, 0), new T.MeshPhysicalMaterial({ color: C(cols[i]), emissive: C(cols[i]), emissiveIntensity: 0.6, roughness: 0.05, clearcoat: 1, flatShading: true, ior: 2.2 }));
      g.scale.set(0.08, 0.15, 0.08); g.position.set(x, y, z); g.rotation.set(0.3 * i, 0.5 * i, 0.2); glowOf(g, cols[i], 0.9); root.add(g); });
  }
  function buildTrophy(fi) {
    const m = materials(fi), root = new T.Group();
    plinth(m, fi, root); cup(m, fi, root); orb(m, fi, root);
    if (fi === 3 || fi === 4) laurel(m, fi, root);
    if (fi >= 5) wings(m, fi, root);
    if (fi >= 6) rings(m, fi, root);
    if (fi >= 7) crown(m, fi, root);
    if (fi === 8) shards(root);
    return { root, m };
  }

  /* ---------- rendering: studio light, a soft bloom on the glowing parts, supersampled ---------- */
  const SS = 2;
  let renderer, envTex;
  function setup(W, H) {
    if (!renderer) {
      renderer = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, premultipliedAlpha: true });
      renderer.setPixelRatio(1); renderer.setClearColor(0x000000, 0); renderer.outputColorSpace = T.SRGBColorSpace;
      envTex = new T.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.035).texture;
    }
    renderer.setSize(W * SS, H * SS, false); renderer.toneMapping = T.NeutralToneMapping; renderer.toneMappingExposure = 1.05;
  }
  function shoot(root, m, cam, W, H, bloom) {
    setup(W, H);
    const scene = new T.Scene(); scene.environment = envTex; scene.environmentRotation = new T.Euler(0, 0.6, 0); scene.add(root);
    const key = new T.DirectionalLight(0xffffff, 3); key.position.set(-4, 6, 7); scene.add(key);
    for (const [x, z] of [[5, -4], [-5, -4]]) { const rim = new T.DirectionalLight(C(m.p[0]), 3.2); rim.position.set(x, 3, z); scene.add(rim); }
    scene.add(new T.HemisphereLight(0xffffff, C(m.p[2]), 0.3));
    renderer.render(scene, cam);
    const base = document.createElement('canvas'); base.width = W * SS; base.height = H * SS; base.getContext('2d').drawImage(renderer.domElement, 0, 0);
    // bloom: the glowing parts alone (everything else black so it hides them), blurred and added over the picture
    const saved = [], black = new T.MeshBasicMaterial({ color: 0x000000, toneMapped: false }), blackBack = new T.MeshBasicMaterial({ color: 0x000000, toneMapped: false, side: T.BackSide });
    scene.traverse(o => { if (!o.isMesh) return; saved.push([o, o.material, o.visible]);
      if (o.material === m.glass) o.visible = false;
      else if (o.userData.glow) { const [c, k] = o.userData.glow; o.material = new T.MeshBasicMaterial({ color: c.clone().multiplyScalar(k), toneMapped: false }); }
      else o.material = o.material.side === T.BackSide ? blackBack : black; });
    renderer.toneMapping = T.NoToneMapping; renderer.render(scene, cam); renderer.toneMapping = T.NeutralToneMapping;
    saved.forEach(([o, mat, v]) => { o.material = mat; o.visible = v; });
    const glow = document.createElement('canvas'); glow.width = base.width; glow.height = base.height; const gx = glow.getContext('2d');
    const add = (blur, a) => { gx.filter = `blur(${blur}px)`; gx.globalAlpha = a; gx.globalCompositeOperation = 'lighter'; gx.drawImage(renderer.domElement, 0, 0); };
    add(base.width / 50, 0.9 * bloom); add(base.width / 18, 0.7 * bloom); gx.filter = 'none';
    const id = gx.getImageData(0, 0, glow.width, glow.height), d = id.data;
    for (let i = 0; i < d.length; i += 4) { const a = d[i + 3] / 255, r = d[i] * a, g = d[i + 1] * a, b = d[i + 2] * a, mx = Math.max(r, g, b); // the glow as light: its brightness becomes its alpha
      if (mx < 1) { d[i + 3] = 0; continue; } d[i] = r * 255 / mx; d[i + 1] = g * 255 / mx; d[i + 2] = b * 255 / mx; d[i + 3] = mx; }
    gx.putImageData(id, 0, 0);
    const out = document.createElement('canvas'); out.width = W; out.height = H; const ox = out.getContext('2d');
    ox.imageSmoothingQuality = 'high'; ox.drawImage(base, 0, 0, W, H); ox.globalCompositeOperation = 'lighter'; ox.globalAlpha = 0.85; ox.drawImage(glow, 0, 0, W, H);
    scene.traverse(x => { if (x.geometry) x.geometry.dispose(); });
    return out;
  }
  const at = (v, cam) => { const p = v.clone().project(cam); return [+((p.x + 1) / 2).toFixed(4), +((1 - p.y) / 2).toFixed(4)]; };

  window.renderTrophy = function (fi, W, H) { // fit the trophy into the 4:5 frame, its base always on the same line
    const { root, m } = buildTrophy(fi), fov = 21, tn = Math.tan(fov / 2 * Math.PI / 180), asp = W / H, box = new T.Box3().setFromObject(root), e = 0.12, foot = 0.95, head = 0.95;
    const halfW = Math.max(-box.min.x, box.max.x) + 0.05, d = Math.max((box.max.y + 0.1) / ((foot + head) * tn), halfW / (head * asp * tn)) + box.max.z;
    const tgt = V3(0, foot * d * tn - 0.04, 0), cam = new T.PerspectiveCamera(fov, asp, 0.1, 100); cam.position.set(0, tgt.y + Math.sin(e) * d, Math.cos(e) * d); cam.lookAt(tgt); cam.updateMatrixWorld();
    const canvas = shoot(root, m, cam, W, H, 0.8);
    return { canvas, orb: at(V3(0, ORB.y, 0), cam) };
  };
  window.renderCrest = function (fi, S) { // every crest in the same square frame, so the shields line up whatever their extras
    const { root, m, sockets } = buildCrest(fi), fov = 20, half = 1.2, cy = 0.11, cam = new T.PerspectiveCamera(fov, 1, 0.1, 100);
    cam.position.set(0, cy, half / Math.tan(fov / 2 * Math.PI / 180) + 0.3); cam.lookAt(0, cy, 0); cam.updateMatrixWorld();
    const canvas = shoot(root, m, cam, S, S, 0.75);
    const gems = sockets.map(v => at(v, cam)), r = sockets.length ? Math.abs(at(sockets[0].clone().add(V3(0.13, 0, 0)), cam)[0] - gems[0][0]) : 0;
    return { canvas, gems, gr: +r.toFixed(4) };
  };
  window.TROPHY_STEPS = STEPS;
})();
