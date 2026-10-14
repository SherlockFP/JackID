/**
 * Debt Terminal seat framing (pure, no three, no DOM). The console (CRT, LEDs, keypad) must sit inside the band of the window
 * between the seat stack's top edge and the control bar (`--seat-bot-t`), so the keypad never hides behind the bar.
 *
 * The camera stays on the seat. `fitView` solves two things: the look pitch that centres the console in the band, and the
 * smallest vertical half-fov (within the game's 40–80° fov clamp) that fits every point inside the band with a margin. The
 * projection is exact (pitch-aware), not the small-angle approximation: a 4:3 window is taller per coin than a 16:9 one, so
 * the approximation drifted there.
 */

export type Vec3 = readonly [number, number, number];

/** A band of the window in NDC y: `top` and `bot` are the band's edges (+1 = the window's top, -1 = its bottom). */
export interface Band { top: number; bot: number }


/** Clearance kept between the console and the band edges, in NDC units (2 = the full window height). */
export const FIT_MARGIN = 0.04;
/** The game's fov clamp (degrees, vertical): the solver never leaves this range. */
export const FOV_MIN_DEG = 40;
export const FOV_MAX_DEG = 80;

/** Band from the bar edges in px from the top of a window `H` px tall. Full window when the edges are missing or too close. */
export function bandFromPx(topPx: number, botPx: number, H: number): Band {
  const full: Band = { top: 1, bot: -1 };
  if (!(H > 0) || !Number.isFinite(topPx) || !Number.isFinite(botPx) || botPx - topPx <= 0.2 * H) return full;
  const f0 = Math.min(0.5, Math.max(0, topPx / H));
  const f1 = Math.max(0.5, Math.min(1, botPx / H));
  return { top: 1 - 2 * f0, bot: 1 - 2 * f1 };
}

/**
 * NDC (x, y) of `p` seen from `cam`, looking with pitch `look` (the view direction is (0, sin look, -cos look)) through a
 * vertical half-fov `vHalf` at `aspect` (width / height). Null when the point is at or behind the camera plane.
 */
export function ndcOf(cam: Vec3, p: Vec3, look: number, vHalf: number, aspect: number): [number, number] | null {
  const vy = p[1] - cam[1];
  const dz = cam[2] - p[2];
  const fwd = vy * Math.sin(look) + dz * Math.cos(look);
  if (fwd <= 1e-6) return null;
  const up = vy * Math.cos(look) - dz * Math.sin(look);
  const t = Math.tan(vHalf) * fwd;
  return [(p[0] - cam[0]) / (t * aspect), up / t];
}

/** NDC of every point, or null when one is behind the camera. */
function project(cam: Vec3, pts: readonly Vec3[], look: number, vHalf: number, aspect: number): Array<[number, number]> | null {
  const out: Array<[number, number]> = [];
  for (const p of pts) {
    const n = ndcOf(cam, p, look, vHalf, aspect);
    if (!n) return null;
    out.push(n);
  }
  return out;
}

/** Look pitch that puts the centre of the points' NDC span on the band centre (the span falls as the pitch rises). */
function centringLook(cam: Vec3, pts: readonly Vec3[], vHalf: number, aspect: number, band: Band): number | null {
  const target = (band.top + band.bot) / 2;
  const centre = (look: number): number | null => {
    const ys = project(cam, pts, look, vHalf, aspect);
    if (!ys) return null;
    const v = ys.map((n) => n[1]);
    return (Math.min(...v) + Math.max(...v)) / 2 - target;
  };
  let lo = -1.25, hi = 1.25;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const g = centre(mid);
    if (g === null) return null;
    if (g > 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** True when, at this half-fov and pitch, every point sits inside the band with the margin and inside the window's width. */
function fits(cam: Vec3, pts: readonly Vec3[], look: number, vHalf: number, aspect: number, band: Band, margin: number): boolean {
  const ns = project(cam, pts, look, vHalf, aspect);
  if (!ns) return false;
  const ys = ns.map((n) => n[1]);
  const xs = ns.map((n) => Math.abs(n[0]));
  return Math.min(...ys) >= band.bot + margin && Math.max(...ys) <= band.top - margin && Math.max(...xs) <= 1 - margin;
}

export interface View { look: number; vHalf: number; fits: boolean }

/**
 * The view that frames `pts` inside `band` from `cam`. The pitch is solved so the span is centred and the half-fov is the
 * smallest that fits (clamped to the game's fov range). `fits` is false when nothing in range fits.
 */
export function fitView(cam: Vec3, pts: readonly Vec3[], band: Band, aspect: number, margin = FIT_MARGIN): View {
  const deg = Math.PI / 180;
  const minV = (FOV_MIN_DEG / 2) * deg, maxV = (FOV_MAX_DEG / 2) * deg;
  // smallest half-fov whose centred view fits: the fit only gets easier as the fov widens
  let lo = 0.05, hi = maxV;
  const feasible = (v: number): boolean => {
    const l = centringLook(cam, pts, v, aspect, band);
    return l !== null && fits(cam, pts, l, v, aspect, band, margin);
  };
  const ok = feasible(hi);
  if (ok) {
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if (feasible(mid)) hi = mid; else lo = mid;
    }
  }
  const vHalf = Math.min(maxV, Math.max(minV, hi));
  const look = centringLook(cam, pts, vHalf, aspect, band) ?? 0;
  return { look, vHalf, fits: ok && feasible(vHalf) };
}

/** Camera offsets the seat may lift or pull back by, cheapest first: a small rise and step back, never toward the console. */
export function cameraCandidates(base: Vec3): Vec3[] {
  const out: Array<{ c: Vec3; cost: number }> = [];
  for (let dz = 0; dz <= 0.4 + 1e-9; dz += 0.05) {
    for (let dy = 0; dy <= 0.2 + 1e-9; dy += 0.05) {
      out.push({ c: [base[0], base[1] + dy, base[2] + dz], cost: dz + 0.5 * dy });
    }
  }
  return out.sort((a, b) => a.cost - b.cost).map((o) => o.c);
}

export interface Framing extends View { cam: Vec3 }

/**
 * Frames the console for the window. `pts` is the whole console; `must` (the keypad and the CRT) must always fit. The camera
 * takes the cheapest offset from `cameraCandidates` that fits everything, else the cheapest that fits `must`, else the base.
 */
export function frameConsole(base: Vec3, pts: readonly Vec3[], must: readonly Vec3[], band: Band, aspect: number): Framing {
  const cands = cameraCandidates(base);
  for (const c of cands) {
    const v = fitView(c, pts, band, aspect);
    if (v.fits) return { ...v, cam: c };
  }
  for (const c of cands) {
    const v = fitView(c, must, band, aspect);
    if (v.fits) return { ...v, cam: c };
  }
  return { ...fitView(base, pts, band, aspect), cam: base };
}
