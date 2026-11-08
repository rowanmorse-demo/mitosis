// The nine rank trophies as 3D models (three.js), one per ladder step, in the step's colours from index.html RANK_STEPS.
// Runs in render.html; render.js drives it and bakes the pictures into index.html. Every trophy shares one camera,
// so they stand on the same line and the higher steps are bigger: a faceted obsidian plinth, a polished metal cup,
// and the step's cell glowing inside a glass orb; handles, gems, a laurel wreath, fins, wings, orbit rings, a crown
// and for Mitosis iridescent metal with a halo are added as the steps climb.
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
  const ORB = { y: 3.62, r: 0.64 };
  const C = h => new T.Color(h), V2 = (x, y) => new T.Vector2(x, y), V3 = (x, y, z) => new T.Vector3(x, y, z);

  function materials(fi) {
    const p = STEPS[fi].pal, top = fi === 8;
    const metal = new T.MeshPhysicalMaterial({ color: C(p[1]), metalness: 1, roughness: 0.22, clearcoat: 0.6, clearcoatRoughness: 0.1, envMapIntensity: 1.05 });
    if (top) Object.assign(metal, { color: C('#ffe39a'), iridescence: 1, iridescenceIOR: 1.9 }); metal.iridescenceThicknessRange = [250, 800];
    const bright = metal.clone(); bright.color = (top ? C('#fff3cc') : C(p[0]).lerp(C(p[1]), 0.45)); bright.roughness = 0.18;
    const deep = metal.clone(); deep.color = C(p[2]).lerp(C(p[1]), 0.42); deep.roughness = 0.3;
    const stone = new T.MeshPhysicalMaterial({ color: C('#0b1112').lerp(C(p[2]), 0.28), metalness: 0.2, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06, flatShading: true, envMapIntensity: 1.1 });
    const gem = new T.MeshPhysicalMaterial({ color: C(p[1]).lerp(C('#ffffff'), 0.15), metalness: 0, roughness: 0.03, ior: 2.3, specularIntensity: 1, clearcoat: 1, emissive: C(p[1]), emissiveIntensity: 0.45, flatShading: true, envMapIntensity: 2 });
    const inside = new T.MeshStandardMaterial({ color: C(p[2]).multiplyScalar(0.25), emissive: C(p[2]), emissiveIntensity: 0.22, roughness: 1, side: T.BackSide });
    // glass: only its reflections show (added over the dark orb), so the cell glows through clear glass
    const glass = new T.MeshPhysicalMaterial({ color: C('#000000'), metalness: 0, roughness: 0.02, clearcoat: 1, clearcoatRoughness: 0, specularIntensity: 1, ior: 1.6, envMapIntensity: 2.4, transparent: true, blending: T.AdditiveBlending, depthWrite: false });
    const membrane = new T.MeshPhysicalMaterial({ color: C(p[1]), emissive: C(p[1]), emissiveIntensity: 0.3, roughness: 0.3, clearcoat: 1, transparent: true, opacity: 0.7, depthWrite: false });
    const core = new T.MeshStandardMaterial({ color: C(p[0]), emissive: C(p[0]).lerp(C(p[1]), 0.2), emissiveIntensity: 1.1, roughness: 0.4 });
    const fibre = new T.MeshBasicMaterial({ color: C(p[0]), transparent: true, opacity: 0.55, depthWrite: false });
    const halo = new T.MeshStandardMaterial({ color: C('#ffe7a0'), emissive: C('#ffcf5a'), emissiveIntensity: 1.1, roughness: 0.25, metalness: 0.3 });
    return { p, top, metal, bright, deep, stone, gem, inside, glass, membrane, core, fibre, halo };
  }
  const glowOf = (mesh, color, k) => { mesh.userData.glow = [C(color), k]; return mesh; };

  // a lathe from [radius, height] pairs; 8 sides for the faceted plinth, smooth otherwise
  function lathe(pts, mat, seg = 64) { return new T.Mesh(new T.LatheGeometry(pts.map(([r, y]) => V2(r, y)), seg, seg === 8 ? Math.PI / 8 : 0), mat); }
  function tube(points, r, mat, closed = false) { return new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(points.map(a => V3(...a)), closed), 48, r, 10, closed), mat); }
  function extrude(shape, depth, bevel, mat) {
    const g = new T.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.9, bevelSegments: 3, curveSegments: 18 });
    g.translate(0, 0, -depth / 2); g.computeVertexNormals(); return new T.Mesh(g, mat);
  }
  function gemMesh(m, sx, sy, sz) { const g = new T.Mesh(new T.OctahedronGeometry(1, 0), m.gem); g.scale.set(sx, sy, sz); return glowOf(g, m.p[1], 0.35); }

  function plinth(m, fi, root) {
    root.add(lathe([[0, 0], [1.34, 0], [1.4, 0.06], [1.4, 0.27], [1.33, 0.34], [0, 0.34]], m.stone, 8));
    root.add(lathe([[0, 0.33], [1.2, 0.33], [1.25, 0.37], [1.25, 0.44], [1.2, 0.48], [0, 0.48]], m.metal, 8));
    root.add(lathe([[0, 0.47], [1.06, 0.47], [1.1, 0.52], [0.93, 1.06], [0.87, 1.11], [0, 1.11]], m.stone, 8));
    root.add(lathe([[0, 1.1], [0.92, 1.1], [0.96, 1.14], [0.96, 1.2], [0.9, 1.25], [0, 1.25]], m.metal, 8));
    // plaque on the slanted front face, with a cabochon (a cut gem from Interphase up)
    const face = new T.Group(); face.position.set(0, 0.79, 0.945); face.rotation.x = -0.272; root.add(face);
    const s = new T.Shape(), w = 0.52, h = 0.19, r = 0.07; s.moveTo(-w + r, -h); s.lineTo(w - r, -h); s.quadraticCurveTo(w, -h, w, -h + r); s.lineTo(w, h - r); s.quadraticCurveTo(w, h, w - r, h); s.lineTo(-w + r, h); s.quadraticCurveTo(-w, h, -w, h - r); s.lineTo(-w, -h + r); s.quadraticCurveTo(-w, -h, -w + r, -h);
    const plate = extrude(s, 0.03, 0.025, m.bright); face.add(plate);
    const inset = extrude(new T.Shape(s.getPoints(24).map(q => V2(q.x * 0.82, q.y * 0.7))), 0.02, 0.01, m.stone); inset.position.z = 0.035; face.add(inset);
    if (fi >= 2) { const g = gemMesh(m, 0.11, 0.11, 0.06); g.position.z = 0.07; g.rotation.z = Math.PI / 4; face.add(g);
      for (const x of [-0.3, 0.3]) { const d = gemMesh(m, 0.05, 0.05, 0.03); d.position.set(x, 0, 0.06); face.add(d); } }
    else { const cab = glowOf(new T.Mesh(new T.SphereGeometry(0.085, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), m.gem), m.p[1], 0.3); cab.rotation.x = Math.PI / 2; cab.position.z = 0.045; cab.scale.set(1, 0.6, 1); face.add(cab); }
    // blade fins on the plinth's sides (Metaphase up)
    if (fi >= 4) for (const sgn of [-1, 1]) {
      const f = new T.Shape(); f.moveTo(0, -0.22); f.quadraticCurveTo(0.35, -0.12, 0.62, 0.34); f.quadraticCurveTo(0.3, 0.12, 0, 0.2); f.closePath();
      const fin = extrude(f, 0.06, 0.03, m.metal); fin.position.set(sgn * 0.98, 0.8, 0.1); fin.scale.x = sgn; fin.rotation.y = sgn * 0.25; root.add(fin);
    }
  }

  function cup(m, fi, root) {
    // stem with a knot, then the bowl
    root.add(lathe([[0, 1.24], [0.56, 1.24], [0.6, 1.29], [0.46, 1.37], [0.27, 1.52], [0.2, 1.72], [0.25, 1.83], [0.37, 1.9], [0.4, 1.96], [0.32, 2.03], [0.2, 2.1], [0.17, 2.2], [0.21, 2.3], [0.3, 2.37], [0, 2.4]], m.metal));
    if (fi >= 2) { const g = gemMesh(m, 0.09, 0.1, 0.06); g.position.set(0, 1.94, 0.41); root.add(g); }
    root.add(lathe([[0, 2.32], [0.3, 2.34], [0.58, 2.45], [0.84, 2.64], [1.0, 2.86], [1.07, 3.04], [1.1, 3.14], [1.18, 3.19], [1.19, 3.24], [1.1, 3.27], [1.02, 3.17], [0.92, 2.94], [0.62, 2.68], [0, 2.6]], m.metal, 96));
    const band = new T.Mesh(new T.TorusGeometry(0.93, 0.045, 12, 96), m.bright); band.rotation.x = Math.PI / 2; band.position.y = 2.73; root.add(band);
    const band2 = new T.Mesh(new T.TorusGeometry(1.155, 0.03, 10, 96), m.bright); band2.rotation.x = Math.PI / 2; band2.position.y = 3.2; root.add(band2);
    if (fi >= 2) { const g = gemMesh(m, 0.12, 0.15, 0.07); g.position.set(0, 2.88, 1.02); g.rotation.x = -0.45; root.add(g); }
    // handles (Colony up); scrolled ends from Metaphase up
    if (fi >= 1) for (const sgn of [-1, 1]) {
      const pts = [[1.02, 3.0, 0], [1.38, 3.06, 0], [1.6, 2.86, 0], [1.56, 2.56, 0], [1.3, 2.42, 0], [0.86, 2.48, 0]];
      root.add(tube(pts.map(([x, y, z]) => [sgn * x, y, z]), 0.075, m.metal));
      if (fi >= 4) { const sc = []; for (let i = 0; i <= 24; i++) { const a = i / 24 * Math.PI * 1.7, rr = 0.2 * (1 - i / 34); sc.push([sgn * (1.46 + rr * Math.cos(a)), 3.12 + rr * Math.sin(a), 0]); }
        root.add(tube(sc, 0.04, m.bright)); }
    }
  }

  function orb(m, fi, root) {
    const o = new T.Group(); o.position.y = ORB.y; root.add(o);
    o.add(new T.Mesh(new T.SphereGeometry(ORB.r * 0.985, 48, 32), m.inside));
    o.add(cell(STEPS[fi].key, m));
    const g = new T.Mesh(new T.SphereGeometry(ORB.r, 64, 48), m.glass); g.renderOrder = 5; o.add(g);
    const light = new T.PointLight(C(m.p[1]), 5, 3, 1.6); o.add(light);
    // cradle prongs
    for (const a of [Math.PI / 4, 3 * Math.PI / 4, -Math.PI / 4, -3 * Math.PI / 4]) {
      const at = (r, y) => [r * Math.sin(a), y, r * Math.cos(a)];
      root.add(tube([at(1.12, 3.22), at(0.98, 3.46), at(0.78, 3.86), at(0.46, 4.1)], 0.05, m.bright));
      const tip = new T.Mesh(new T.SphereGeometry(0.07, 16, 12), m.bright); tip.position.set(...at(0.46, 4.1)); root.add(tip);
    }
  }

  // the step's cell, inside the orb (radius about 0.5)
  function cell(key, m) {
    const g = new T.Group(), core = m.core, mem = m.membrane, p = m.p;
    const ball = (r, mat, x = 0, y = 0, z = 0, seg = 32) => { const s = new T.Mesh(new T.SphereGeometry(r, seg, seg * 0.75), mat); s.position.set(x, y, z); if (mat === core) glowOf(s, p[0], 1); if (mat === mem) glowOf(s, p[1], 0.22); return s; };
    const capsule = (len, r, mat) => { const c = new T.Mesh(new T.CapsuleGeometry(r, len, 6, 14), mat); glowOf(c, p[0], 1); return c; };
    const chromosome = (x, y, z, rot, s = 1) => { const c = new T.Group(); for (const a of [0.42, -0.42]) { const k = capsule(0.2 * s, 0.035 * s, core); k.rotation.z = a; c.add(k); } c.position.set(x, y, z); c.rotation.set(0.3, 0.4, rot); return c; };
    const spindle = (from, tos) => { for (const to of tos) { const a = V3(...from), b = V3(...to), d = b.clone().sub(a), f = new T.Mesh(new T.CylinderGeometry(0.008, 0.008, d.length(), 5), m.fibre); f.position.copy(a).add(b).multiplyScalar(0.5); f.quaternion.setFromUnitVectors(V3(0, 1, 0), d.normalize()); g.add(f); } };
    const blob = (r, seed, amp) => { const geo = new T.IcosahedronGeometry(r, 5), pos = geo.attributes.position, v = new T.Vector3();
      for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).normalize(); const n = 1 + amp * (Math.sin(3 * v.x + seed) * Math.sin(2.6 * v.y + seed * 1.7) + 0.6 * Math.sin(4.2 * v.z - seed) * Math.cos(3.1 * v.x + seed * 0.5)); pos.setXYZ(i, v.x * r * n, v.y * r * n * 0.92, v.z * r * n * 0.8); }
      geo.computeVertexNormals(); return glowOf(new T.Mesh(geo, mem), p[1], 0.22); };
    switch (key) {
      case 'amoeba': g.add(blob(0.4, 1.3, 0.28)); g.add(ball(0.13, core, 0.06, 0.03, 0.05)); g.add(ball(0.05, core, -0.17, -0.12, 0.12)); break;
      case 'colony': { const pts = [[0, 0, 0]]; for (let i = 0; i < 6; i++) pts.push([0.27 * Math.cos(i * Math.PI / 3 + 0.5), 0.27 * Math.sin(i * Math.PI / 3 + 0.5), 0]); pts.push([0, 0, 0.24], [0, 0, -0.24]);
        for (const [x, y, z] of pts) { g.add(ball(0.15, mem, x, y, z, 24)); g.add(ball(0.055, core, x + 0.02, y + 0.02, z + 0.05, 16)); } break; }
      case 'interphase': g.add(ball(0.44, mem)); g.add(ball(0.22, core)); { const c = new T.Group(); for (let i = 0; i < 3; i++) { const pts = []; for (let j = 0; j <= 10; j++) { const t = j / 10; pts.push([-0.15 + 0.3 * t, 0.09 - i * 0.09 + 0.03 * Math.sin(t * 12 + i), 0.2]); } c.add(tube(pts, 0.014, m.deep)); } g.add(c); } break;
      case 'prophase': g.add(ball(0.46, mem)); g.add(chromosome(-0.15, 0.11, 0.08, 0.3)); g.add(chromosome(0.16, 0.12, -0.05, -0.6)); g.add(chromosome(0.0, -0.16, 0.06, 1.1)); g.add(chromosome(0.14, -0.06, 0.18, 0.2, 0.8)); break;
      case 'metaphase': { g.add(ball(0.47, mem)); const ys = [-0.2, -0.07, 0.07, 0.2]; ys.forEach(y => g.add(chromosome(0, y, 0.05, Math.PI / 2, 0.75)));
        g.add(ball(0.05, core, -0.36, 0, 0)); g.add(ball(0.05, core, 0.36, 0, 0)); spindle([-0.36, 0, 0], ys.map(y => [0, y, 0.05])); spindle([0.36, 0, 0], ys.map(y => [0, y, 0.05])); break; }
      case 'anaphase': { const e = ball(0.47, mem); e.scale.set(1.12, 0.86, 0.86); g.add(e); const ys = [-0.13, 0, 0.13];
        for (const sx of [-1, 1]) { ys.forEach(y => { const v = new T.Group(); for (const a of [0.5, -0.5]) { const k = capsule(0.12, 0.03, core); k.rotation.z = Math.PI / 2 + a * sx; k.position.x = sx * 0.04; v.add(k); } v.position.set(sx * (0.2 + Math.abs(y) * 0.2), y, 0.05); g.add(v); });
          g.add(ball(0.045, core, sx * 0.42, 0, 0)); spindle([sx * 0.42, 0, 0], ys.map(y => [sx * 0.2, y, 0.05])); } break; }
      case 'telophase': { for (const sx of [-1, 1]) { const b = ball(0.29, mem, sx * 0.21, 0, 0); g.add(b); const n = ball(0.11, core, sx * 0.25, 0.02, 0.06); g.add(n); }
        const waist = new T.Mesh(new T.TorusGeometry(0.2, 0.03, 10, 40), m.core); waist.rotation.y = Math.PI / 2; glowOf(waist, p[0], 0.8); g.add(waist); g.rotation.z = 0.5; break; }
      case 'cytokinesis': { for (const sx of [-1, 1]) { g.add(ball(0.24, mem, sx * 0.25, sx * 0.13, 0)); g.add(ball(0.1, core, sx * 0.27, sx * 0.15, 0.08)); }
        const br = capsule(0.16, 0.035, core); br.rotation.z = Math.PI / 2 + 0.48; g.add(br); break; }
      case 'mitosis': { for (const sx of [-1, 1]) { g.add(ball(0.22, mem, sx * 0.24, -sx * 0.16, -0.05)); g.add(ball(0.08, core, sx * 0.25, -sx * 0.16, 0.08)); }
        const st = new T.Shape(); for (let i = 0; i < 8; i++) { const a = Math.PI / 2 + i * Math.PI / 4, r = i % 2 ? 0.07 : 0.3; i ? st.lineTo(r * Math.cos(a), r * Math.sin(a)) : st.moveTo(r * Math.cos(a), r * Math.sin(a)); }
        st.closePath(); const s = extrude(st, 0.04, 0.02, m.halo); s.position.z = 0.15; glowOf(s, '#fff6d6', 1.3); g.add(s); break; }
    }
    return g;
  }

  function laurel(m, fi, root) { // a wreath of metal leaves behind the cup (Prophase up)
    const leaf = new T.Shape(); leaf.moveTo(0, 0); leaf.quadraticCurveTo(0.17, 0.15, 0.4, 0); leaf.quadraticCurveTo(0.17, -0.15, 0, 0);
    const cx = 0, cy = 3.05, R = 1.62, z = -0.5, from = -100, to = fi >= 6 ? 48 : 30;
    for (const sgn of [-1, 1]) {
      const arc = []; for (let d = from; d <= to + 0.1; d += 8) { const t = d * Math.PI / 180; arc.push([sgn * R * Math.cos(t) + cx, cy + R * Math.sin(t), z]); }
      root.add(tube(arc, 0.05, m.deep));
      for (let d = from + 10; d <= to; d += 14) { const t = d * Math.PI / 180;
        for (const o of [-1, 1]) { const l = extrude(leaf, 0.04, 0.03, (d / 11) % 2 ? m.metal : m.bright); l.position.set(sgn * R * Math.cos(t), cy + R * Math.sin(t), z + 0.02);
          const tang = t + Math.PI / 2; l.rotation.z = sgn > 0 ? tang + o * 0.6 : Math.PI - tang - o * 0.6; root.add(l); } }
    }
  }

  function feather(len, w, mat, bend) { // a broad blade with a rounded tip, bent along its length
    const f = new T.Shape(); f.moveTo(0, -w * 0.45); f.quadraticCurveTo(len * 0.6, -w * 0.75, len * 0.97, -w * 0.12); f.quadraticCurveTo(len * 1.02, w * 0.2, len * 0.86, w * 0.42); f.quadraticCurveTo(len * 0.45, w * 0.7, 0, w * 0.45); f.closePath();
    const fe = extrude(f, 0.05, 0.035, mat), pos = fe.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) { const u = Math.max(0, pos.getX(i) / len); pos.setY(i, pos.getY(i) - bend * len * u * u); pos.setZ(i, pos.getZ(i) - 0.12 * len * u * u); }
    fe.geometry.computeVertexNormals(); return fe;
  }
  function wings(m, fi, root) { // feathered wings sweeping out and back from behind the cup (Anaphase up)
    const big = fi >= 7 ? 1.15 : fi >= 6 ? 1.07 : 1, n = 7;
    for (const sgn of [-1, 1]) {
      const side = new T.Group(); side.position.set(sgn * 0.62, 3.1, -0.62); side.rotation.y = sgn * 0.62; side.scale.x = sgn; root.add(side);
      for (let i = 0; i < n; i++) { // flight feathers: the higher, the longer
        const fe = feather((1.05 + i * 0.2) * big, 0.32, i % 2 ? m.metal : m.top ? m.bright : m.deep, 0.15);
        fe.rotation.z = (-12 + i * 15.5) * Math.PI / 180; fe.position.set(0.02 * i, -0.3 + i * 0.08, -0.05 * i); side.add(fe);
      }
      for (let i = 0; i < 5; i++) { // coverts over their roots
        const fe = feather((0.6 + i * 0.1) * big, 0.27, m.bright, 0.12);
        fe.rotation.z = (-8 + i * 21) * Math.PI / 180; fe.position.set(0, -0.18 + i * 0.07, 0.12); side.add(fe);
      }
    }
  }

  function rings(m, fi, root) { // orbit rings around the orb (Telophase up)
    const k = fi >= 7 ? 2 : 1;
    for (let i = 0; i < k; i++) { const r = new T.Mesh(new T.TorusGeometry(0.98 + i * 0.08, 0.04, 12, 120), m.bright); r.position.y = ORB.y; r.rotation.set(Math.PI / 2 - 0.32, 0, i ? -0.42 : 0.36); root.add(r);
      const bead = glowOf(new T.Mesh(new T.SphereGeometry(0.06, 16, 12), m.core), m.p[0], 1); const a = i ? 2.2 : -0.6; bead.position.set((0.98 + i * 0.08) * Math.cos(a), (0.98 + i * 0.08) * Math.sin(a), 0); r.add(bead); }
  }

  function crown(m, fi, root) { // above the orb (Cytokinesis up)
    const c = new T.Group(); c.position.y = ORB.y + ORB.r - 0.06; root.add(c);
    c.add(lathe([[0.36, 0], [0.42, 0.02], [0.44, 0.17], [0.39, 0.19], [0.34, 0.02]], m.metal, 64));
    for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2 + Math.PI / 7 * 0.5, sp = new T.Mesh(new T.ConeGeometry(0.075, i % 2 ? 0.28 : 0.4, 8), m.metal); sp.position.set(0.41 * Math.sin(a), 0.32, 0.41 * Math.cos(a)); sp.rotation.set(Math.cos(a) * 0.25, 0, -Math.sin(a) * 0.25); c.add(sp);
      const tip = new T.Mesh(new T.SphereGeometry(0.055, 12, 10), m.bright); tip.position.set(0.45 * Math.sin(a), i % 2 ? 0.48 : 0.55, 0.45 * Math.cos(a)); c.add(tip); }
    const g = gemMesh(m, 0.08, 0.09, 0.045); g.position.set(0, 0.1, 0.44); c.add(g);
    if (fi === 8) { const h = glowOf(new T.Mesh(new T.TorusGeometry(0.62, 0.065, 16, 96), m.halo), '#ffd36b', 0.8); h.position.y = 1.0; h.rotation.x = Math.PI / 2 - 0.42; c.add(h); }
  }

  function shards(m, root) { // Mitosis: prism shards floating around
    const cols = ['#ff8ab0', '#a98bff', '#6fe3dc', '#ffe58f', '#ff8ab0', '#6fe3dc'], at = [[-1.75, 4.25, 0.2], [1.8, 4.05, 0.1], [-1.95, 2.35, 0.3], [1.95, 2.55, 0.3], [-1.2, 4.95, -0.2], [1.25, 5.0, -0.2]];
    at.forEach(([x, y, z], i) => { const g = new T.Mesh(new T.OctahedronGeometry(1, 0), new T.MeshPhysicalMaterial({ color: C(cols[i]), emissive: C(cols[i]), emissiveIntensity: 0.6, roughness: 0.05, clearcoat: 1, flatShading: true, ior: 2.2 }));
      g.scale.set(0.08, 0.15, 0.08); g.position.set(x, y, z); g.rotation.set(0.3 * i, 0.5 * i, 0.2); glowOf(g, cols[i], 0.9); root.add(g); });
  }

  function build(fi) {
    const m = materials(fi), root = new T.Group();
    plinth(m, fi, root); cup(m, fi, root); orb(m, fi, root);
    if (fi === 3 || fi === 4) laurel(m, fi, root);
    if (fi >= 5) wings(m, fi, root);
    if (fi >= 6) rings(m, fi, root);
    if (fi >= 7) crown(m, fi, root);
    if (fi === 8) shards(m, root);
    return { root, m };
  }

  // one shared renderer; render(fi) returns the picture (premultiplied canvas) and where the orb landed (0-1 of the frame)
  const SS = 2;
  let renderer, pmrem, envTex;
  function setup(W, H) {
    if (renderer) { renderer.setSize(W * SS, H * SS, false); return; }
    renderer = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, premultipliedAlpha: true });
    renderer.setPixelRatio(1); renderer.setSize(W * SS, H * SS, false); renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = T.NeutralToneMapping; renderer.toneMappingExposure = 1.05; renderer.outputColorSpace = T.SRGBColorSpace;
    pmrem = new T.PMREMGenerator(renderer); envTex = pmrem.fromScene(new RoomEnvironment(), 0.035).texture;
  }
  function camera(W, H, root) { // fit the trophy into the frame, its base always at the same height
    const fov = 21, tn = Math.tan(fov / 2 * Math.PI / 180), asp = W / H, box = new T.Box3().setFromObject(root), e = 0.12, foot = 0.95, head = 0.95;
    const halfW = Math.max(-box.min.x, box.max.x) + 0.05, d = Math.max((box.max.y + 0.1) / ((foot + head) * tn), halfW / (head * asp * tn)) + box.max.z;
    const tgt = V3(0, foot * d * tn - 0.04, 0), cam = new T.PerspectiveCamera(fov, asp, 0.1, 100); cam.position.set(0, tgt.y + Math.sin(e) * d, Math.cos(e) * d); cam.lookAt(tgt); return cam; }

  window.renderTrophy = function (fi, W, H) {
    setup(W, H);
    const scene = new T.Scene(); scene.environment = envTex; scene.environmentRotation = new T.Euler(0, 0.6, 0);
    const { root, m } = build(fi); scene.add(root);
    const key = new T.DirectionalLight(0xffffff, 3); key.position.set(-4, 6, 7); scene.add(key);
    for (const [x, z] of [[5, -4], [-5, -4]]) { const rim = new T.DirectionalLight(C(m.p[0]), 3.2); rim.position.set(x, 3, z); scene.add(rim); }
    scene.add(new T.HemisphereLight(0xffffff, C(m.p[2]), 0.3));
    const cam = camera(W, H, root);
    renderer.render(scene, cam);
    const base = document.createElement('canvas'); base.width = W * SS; base.height = H * SS; base.getContext('2d').drawImage(renderer.domElement, 0, 0);
    // bloom: the glowing parts alone, blurred and added over the picture
    const saved = [], black = new T.MeshBasicMaterial({ color: 0x000000, toneMapped: false }), blackBack = new T.MeshBasicMaterial({ color: 0x000000, toneMapped: false, side: T.BackSide });
    scene.traverse(o => { if (!o.isMesh) return; saved.push([o, o.material, o.visible]);
      if (o.material === m.glass || o.material === m.fibre) o.visible = false;
      else if (o.userData.glow) { const [c, k] = o.userData.glow; const t = o.material.transparent; o.material = new T.MeshBasicMaterial({ color: c.clone().multiplyScalar(k), toneMapped: false, transparent: t, opacity: t ? o.material.opacity : 1, depthWrite: !t }); }
      else o.material = o.material.side === T.BackSide ? blackBack : black; });
    renderer.toneMapping = T.NoToneMapping; renderer.render(scene, cam); renderer.toneMapping = T.NeutralToneMapping;
    saved.forEach(([o, mat, v]) => { o.material = mat; o.visible = v; });
    const glow = document.createElement('canvas'); glow.width = base.width; glow.height = base.height; const gx = glow.getContext('2d');
    const add = (blur, a) => { gx.filter = `blur(${blur}px)`; gx.globalAlpha = a; gx.globalCompositeOperation = 'lighter'; gx.drawImage(renderer.domElement, 0, 0); };
    add(6 * SS, 0.9); add(16 * SS, 0.8); gx.filter = 'none';
    const id = gx.getImageData(0, 0, glow.width, glow.height), d = id.data;
    for (let i = 0; i < d.length; i += 4) { const a = d[i + 3] / 255, r = d[i] * a, g = d[i + 1] * a, b = d[i + 2] * a, mx = Math.max(r, g, b); // the glow as light: its brightness becomes its alpha
      if (mx < 1) { d[i + 3] = 0; continue; } d[i] = r * 255 / mx; d[i + 1] = g * 255 / mx; d[i + 2] = b * 255 / mx; d[i + 3] = mx; }
    gx.putImageData(id, 0, 0);
    const out = document.createElement('canvas'); out.width = W; out.height = H; const ox = out.getContext('2d');
    ox.imageSmoothingQuality = 'high'; ox.drawImage(base, 0, 0, W, H); ox.globalCompositeOperation = 'lighter'; ox.globalAlpha = 0.85; ox.drawImage(glow, 0, 0, W, H);
    const o = V3(0, ORB.y, 0).project(cam);
    scene.traverse(x => { if (x.geometry) x.geometry.dispose(); });
    return { canvas: out, orb: [(o.x + 1) / 2, (1 - o.y) / 2] };
  };
  window.TROPHY_STEPS = STEPS;
})();
