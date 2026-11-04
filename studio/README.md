# Facet Studio

A 3D modeler, sculptor and path tracer in a single web page. It runs on any computer, tablet or phone with WebGL 2, with nothing to install.

Open `studio/index.html` in a browser. It loads three.js and the path tracer from cdn.jsdelivr.net, so the first load needs a connection.

## What it does

**Modeling**
- Polygon meshes with real quads and n-gons. Thirteen starting shapes, including a studio backdrop, a high-resolution sculpt ball and a procedural rock.
- Edit mode: vertex, edge and face selection, box select, Alt-click loop and ring select, select linked, X-ray.
- Mesh tools: extrude, inset, loop cut, merge, fill, delete, subdivide, tris to quads, merge by distance, flip and recalculate normals.
- Proportional editing (soft falloff) for G, R and S. Use the mouse wheel to change the radius while moving.
- **Subdivision surfaces** (Catmull-Clark) with **semi-sharp edge creases**, following Pixar's rules. Crease an edge and it stays crisp while the rest of the surface rounds off, which gives hard-surface shapes without support loops.
- Modifier stack: Subdivision surface, Mirror (with clipping at the seam), Array and Solidify. Modifiers can be reordered, toggled or applied.
- **Voxel remesh** (Ctrl+R in sculpt mode, or the Remesh section of the Object panel): rebuilds any closed mesh as even quads at a chosen voxel size and shows an estimate of the face count first. Overlapping parts fuse into one solid. The new surface is relaxed and snapped back onto the original, so detail larger than the voxel size survives.
- **Join meshes**: merges other meshes into the selected one, with their modifiers and transforms applied. Block a creature out of spheres and cylinders, join them, remesh, then sculpt.

**Sculpting**
- Eight brushes: Draw, Clay, Inflate, Smooth, Grab, Flatten, Pinch and Crease. Hold Ctrl to invert a brush and Shift to smooth.
- **Dynamic topology** (Dyntopo in the sculpt header): under the brush, edges longer than the detail size split and very short ones collapse. Horns, fingers and spikes then grow without stretching. Detail is set in screen pixels, so zooming in gives finer detail. Dyntopo sculpts on triangles; remesh afterwards to get quads back.
- X-mirrored strokes, and one-click subdivision for more detail.
- Handles a few hundred thousand vertices on a desktop GPU. Every stroke can be undone.

**Rendering**
- Material preview with real-time PBR materials and shadows.
- A **path-traced rendered view** (three-gpu-pathtracer) with physically based glass, metal, clearcoat, sheen and iridescence. Area, point, spot and sun lights all cast correct soft shadows, with depth of field and bokeh blades.
- Lighting from studio softboxes, procedural skies (clear, sunset, overcast, night) or your own `.hdr` and `.exr` HDRIs.
- Final renders (F12) at HD, 4K, square, portrait or story sizes, with an optional transparent background, saved as PNG.
- Sixteen material presets with live thumbnails, plus image textures.

**Files**
- Projects save as `.facet.json`, and the scene autosaves in the browser.
- Import GLB/glTF, OBJ, STL, PLY and FBX models, and HDR/EXR environments. Images can be dropped on to use as textures.
- Export GLB, OBJ (quads kept), STL for 3D printing, USDZ for iPhone AR Quick Look, and PLY.
- When the page runs as a claude.ai artifact, file types the viewer can't save directly are wrapped in a `.zip`.

**Workflow**
- Blender's keys where possible: G/R/S then X/Y/Z, typed values, Tab, Shift+A, E, I, Ctrl+R and numpad views.
- A command palette (Ctrl+K) that searches every action.
- Unlimited undo for every edit, including slider drags and sculpt strokes.
- On phones, panels become drawers and tools move to a bottom bar. Sculpting on touch works like Nomad: a finger on the mesh sculpts, a finger on the background orbits.

## Compared with Blender

Facet is better at a few specific things. It opens instantly in a browser or on a phone, it's easier to learn, and it has a searchable command palette, one-click materials and USDZ export.

Blender is far deeper: animation and rigging, geometry nodes, UV unwrapping, texture painting, multires sculpting, simulations, video editing, and the Cycles feature set (subsurface scattering, volumes, hair). Facet's path tracer uses the same physically based method as Cycles, but sharp, noise-free images still depend on your GPU and the sample count.

## Tests

```bash
node tools/studio-test.js
```

The test runs headless Chrome through Playwright. It checks the subdivision math, edit-mode operations, keyboard transforms, sculpting and its undo, voxel remesh accuracy and fusing, dynamic topology mesh validity and undo, join, project round-trips and every export format. To run it offline, set `STUDIO_LIBS` to a local `node_modules` (see the header of the script).

## Built on

[three.js](https://threejs.org) r186, [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) and [three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer), with versions pinned in the page's import map.
