// Perf probe for the pit (see docs/PERF.md). Run through the harness, which starts a real debt run:
//   node scripts/qa/bench.mjs --world --seed 1 --js "$(cat scripts/qa/perf-probe.js)" --script "wait:45000" --probe "window.__perf ?? null"
// --js starts the job and returns at once; the job walks 4 positions x 4 yaws, teleporting the player (devtools only),
// and stores the result in window.__perf, which the --probe reads after the wait. Read-only apart from the teleport.
(() => {
  window.__perf = { status: 'running' };
  (async () => {
    try {
      const app = window.jackid.app, world = app.world, root = world.root, cam = app.camera;
      const V = cam.position.constructor;
      const raf = () => new Promise((r) => requestAnimationFrame((t) => r(t)));
      const abortCut = async () => { if (app.cutscene.playing) { app.cutscene.abort(); for (let i = 0; i < 60 && app.cutscene.playing; i++) await raf(); } };
      await abortCut();
      const spawn = world.spawn('solo');
      const floorY = (x, z) => { try { return world.collision.floorAt(x, z, 2) ?? 0; } catch (e) { return 0; } };
      const isMesh = (o) => o.isMesh || o.isSprite || o.isLine || o.isPoints;
      const meshTris = (o) => {
        if (o.isSprite) return 2;
        const g = o.geometry; if (!g) return 0;
        const idx = g.index, pos = g.attributes && g.attributes.position;
        let t = idx ? idx.count / 3 : (pos ? pos.count / 3 : 0);
        if (o.isInstancedMesh) t *= o.count;
        return Math.round(t);
      };
      const meshCalls = (o) => (Array.isArray(o.material) ? Math.max(1, (o.geometry && o.geometry.groups && o.geometry.groups.length) || 1) : 1);
      // visible leaves under obj (three skips children of invisible nodes)
      const leaves = (obj) => {
        const out = [];
        const walk = (o) => { if (!o.visible) return; if (isMesh(o)) out.push(o); for (const c of o.children) walk(c); };
        walk(obj); return out;
      };
      const chainVisible = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
      const stat = (list) => list.reduce((a, o) => { a.calls += meshCalls(o); a.tris += meshTris(o); return a; }, { calls: 0, tris: 0 });
      const P = cam.projectionMatrix.elements;
      // bounding-sphere test against the view frustum (estimate; ignores farCull, occlusion, shadows)
      const inView = (o, near, far, tanH, tanV, Vm) => {
        const g = o.geometry;
        if (!g) return true;
        if (!g.boundingSphere) g.computeBoundingSphere();
        const bs = g.boundingSphere; if (!bs) return true;
        const e = o.matrixWorld.elements, cx = bs.center.x, cy = bs.center.y, cz = bs.center.z;
        const wx = e[0] * cx + e[4] * cy + e[8] * cz + e[12];
        const wy = e[1] * cx + e[5] * cy + e[9] * cz + e[13];
        const wz = e[2] * cx + e[6] * cy + e[10] * cz + e[14];
        const r = bs.radius * Math.max(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10]));
        const vx = Vm[0] * wx + Vm[4] * wy + Vm[8] * wz + Vm[12];
        const vy = Vm[1] * wx + Vm[5] * wy + Vm[9] * wz + Vm[13];
        const vz = Vm[2] * wx + Vm[6] * wy + Vm[10] * wz + Vm[14];
        const d = -vz;
        if (d + r < near || d - r > far) return false;
        if (Math.abs(vx) > d * tanH + r) return false;
        if (Math.abs(vy) > d * tanV + r) return false;
        return true;
      };
      const machines = world.machines().map((m) => {
        const slot = root.getObjectByName('slot:' + m.id) || null;
        return { id: m.id, mid: (m.def && m.def.id) || null, slot, leaves: slot && chainVisible(slot) ? leaves(slot) : [] };
      });
      const machineSlotNames = new Set(machines.map((m) => 'slot:' + m.id));
      const machineLeaves = new Set(); machines.forEach((m) => m.leaves.forEach((o) => machineLeaves.add(o)));
      const others = root.children.filter((c) => !machineSlotNames.has(c.name) && chainVisible(c));
      const otherTop = others.map((c) => ({ name: c.name || c.type, ...stat(leaves(c)) })).sort((a, b) => b.tris - a.tris);
      const machStatic = machines.map((m) => ({ id: m.id, mid: m.mid, ...stat(m.leaves) })).sort((a, b) => b.tris - a.tris);
      const totalStatic = stat([...machineLeaves, ...others.flatMap((c) => leaves(c))]);
      const maxInView = new Map();
      const views = [];
      const positions = [
        { name: 'spawn', x: spawn.pos[0], z: spawn.pos[2], yaw0: spawn.yaw },
        { name: 'well', x: 0, z: -9, yaw0: 0 },
        { name: 'jade', x: -21, z: -9, yaw0: 0 },
        { name: 'boiler', x: 21, z: -23, yaw0: 0 },
      ];
      for (const p of positions) {
        for (let k = 0; k < 4; k++) {
          await abortCut();
          const yaw = p.yaw0 + (k * Math.PI) / 2;
          const y = p.name === 'spawn' ? spawn.pos[1] : floorY(p.x, p.z);
          app.player.teleport(new V(p.x, y, p.z), yaw);
          await raf(); await raf();
          const ts = [];
          for (let f = 0; f < 12; f++) ts.push(await raf());
          const dt = (ts[ts.length - 1] - ts[0]) / (ts.length - 1);
          const i = app.renderer.info();
          cam.updateMatrixWorld(true);
          const Vm = cam.matrixWorldInverse.elements, near = cam.near, far = cam.far, tanH = 1 / P[0], tanV = 1 / P[5];
          let mc = 0, mt = 0; const per = [];
          const nowOthers = root.children.filter((c) => !machineSlotNames.has(c.name) && chainVisible(c));
          for (const m of machines) {
            let c = 0, t = 0;
            const nowLeaves = m.slot && chainVisible(m.slot) ? leaves(m.slot) : [];
            for (const o of nowLeaves) { if (inView(o, near, far, tanH, tanV, Vm)) { c += meshCalls(o); t += meshTris(o); } }
            if (t > 0 || c > 0) { per.push({ id: m.id, mid: m.mid, calls: c, tris: t }); mc += c; mt += t; }
            const prev = maxInView.get(m.id);
            if (!prev || t > prev.tris) maxInView.set(m.id, { id: m.id, mid: m.mid, tris: t, calls: c, view: p.name + '/' + k });
          }
          let oc = 0, ot = 0; const otherRows = {};
          for (const c of nowOthers) for (const o of leaves(c)) {
            if (!inView(o, near, far, tanH, tanV, Vm)) continue;
            const cc = meshCalls(o), tt = meshTris(o); oc += cc; ot += tt;
            const key = c.name || c.type; otherRows[key] = otherRows[key] || { calls: 0, tris: 0 };
            otherRows[key].calls += cc; otherRows[key].tris += tt;
          }
          per.sort((a, b) => b.tris - a.tris);
          views.push({
            view: p.name, yawDeg: Math.round((yaw * 180) / Math.PI), pos: [+p.x.toFixed(1), +y.toFixed(2), +p.z.toFixed(1)],
            calls: i.calls, tris: i.tris, geo: i.geometries, tex: i.textures, prog: i.programs, cpuMs: +i.cpuMs.toFixed(2),
            frameMs: +dt.toFixed(2), fps: +(1000 / dt).toFixed(1),
            inViewMachines: { calls: mc, tris: mt, n: per.length }, inViewOther: { calls: oc, tris: ot },
            topMachines: per.slice(0, 5),
            topOther: Object.entries(otherRows).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.tris - a.tris).slice(0, 4),
          });
        }
      }
      const offenders = [...maxInView.values()].sort((a, b) => b.tris - a.tris).slice(0, 12);
      window.__perf = {
        status: 'done',
        renderer: { w: app.renderer.canvas.width, h: app.renderer.canvas.height, dpr: window.devicePixelRatio },
        gates: { wingCardsOpen: world.isZoneOpen ? world.isZoneOpen('cards') : null, wingBoilerOpen: world.isZoneOpen ? world.isZoneOpen('boiler') : null },
        machineCount: machines.length,
        staticVisibleTotal: { ...totalStatic, machines: stat([...machineLeaves]), nonMachine: stat(others.flatMap((c) => leaves(c))) },
        staticNonMachineTop: otherTop.slice(0, 8),
        staticTopByTris: machStatic.slice(0, 12),
        staticTopByCalls: [...machStatic].sort((a, b) => b.calls - a.calls).slice(0, 12),
        maxInViewOffenders: offenders,
        views,
      };
    } catch (e) {
      window.__perf = { status: 'error', error: String(e && (e.stack || e.message || e)) };
    }
  })();
  return 'started';
})()
