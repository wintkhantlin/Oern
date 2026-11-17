// Human-like pointer movement for the desktop walkthrough.
// See MOUSE_MOVEMENT.md for the reasoning behind each parameter.

export const MOUSE = {
  hz: 60, // pointer sample rate (a typical display refresh)
  fittsA: 0.18, // s, Fitts intercept
  fittsB: 0.11, // s per bit, Fitts slope
  pace: 1.15, // >1 = calmer than a hurried user, so viewers can follow
  primaryShare: 0.78, // share of movement time used by the ballistic primary submovement
  gainMean: 0.965, // primary submovement lands slightly short on average
  gainSd: 0.015,
  lateralSd: 0.012, // sideways endpoint scatter, as a share of distance
  curveSd: 0.035, // path bow, as a share of distance
  tremorPx: 0.25, // physiological tremor amplitude at ~10 Hz
  correctThresholdPx: 2,
  aimDwell: [140, 260], // ms between arriving and pressing
  pressHold: [70, 120], // ms the button stays down
};

const rand = (rng = Math.random) => rng();
const gauss = (rng = Math.random) => {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
export const between = ([lo, hi], rng = Math.random) => lo + (hi - lo) * rand(rng);

/** Minimum-jerk position profile (Flash & Hogan): 0→1 with zero velocity and acceleration at both ends. */
export const minJerk = (t) => t * t * t * (10 - 15 * t + 6 * t * t);

/** Fitts movement time (Shannon form) in seconds for distance d and target width w (px). */
export const fittsTime = (d, w, m = MOUSE) => m.pace * (m.fittsA + m.fittsB * Math.log2(d / Math.max(w, 4) + 1));

/** One smooth submovement from a to b along a gentle arc; returns samples excluding the start point. */
function submove(a, b, seconds, bow, m, rng, t0) {
  const n = Math.max(2, Math.round(seconds * m.hz));
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len; // unit normal for the arc
  const out = [];
  for (let i = 1; i <= n; i++) {
    const u = minJerk(i / n);
    const arc = bow * Math.sin(Math.PI * u);
    const time = t0 + (i / n) * seconds;
    const tremor = i === n ? 0 : m.tremorPx * Math.sin(2 * Math.PI * 10 * time) + gauss(rng) * m.tremorPx * 0.3;
    out.push({ x: a.x + dx * u + nx * (arc + tremor), y: a.y + dy * u + ny * (arc + tremor), t: time });
  }
  return out;
}

/**
 * Plans a pointing movement from `from` to `to`, aiming at a target `width` px wide.
 * Returns samples {x, y, t} (t in seconds from the start) ending exactly on `to`.
 */
export function planMove(from, to, width = 40, m = MOUSE, rng = Math.random) {
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  if (d < 1) return [{ ...to, t: 0 }];
  const mt = fittsTime(d, width, m);
  const ux = (to.x - from.x) / d, uy = (to.y - from.y) / d;
  // Primary (ballistic) submovement: slightly short, with sideways scatter.
  const gain = m.gainMean + gauss(rng) * m.gainSd;
  const side = gauss(rng) * m.lateralSd * d;
  const land = { x: from.x + ux * d * gain - uy * side, y: from.y + uy * d * gain + ux * side };
  const bow = gauss(rng) * m.curveSd * d;
  const primaryT = mt * m.primaryShare;
  const samples = submove(from, land, primaryT, bow, m, rng, 0);
  // Corrective submovement: small, slower homing onto the target.
  const miss = Math.hypot(to.x - land.x, to.y - land.y);
  if (miss > m.correctThresholdPx) {
    const gap = 0.02 + rand(rng) * 0.03; // brief pause while the eye checks the landing
    const corrT = Math.max(0.1, mt * (1 - m.primaryShare) - gap);
    samples.push(...submove(land, to, corrT, 0, m, rng, primaryT + gap));
  } else {
    samples.push({ ...to, t: primaryT + 1 / m.hz });
  }
  return samples;
}

/** Scroll as a short flick: wheel deltas that ease in and out instead of arriving in one jump. */
export function planScroll(total, seconds = 0.8, m = MOUSE) {
  const n = Math.max(4, Math.round(seconds * m.hz));
  const out = [];
  let prev = 0;
  for (let i = 1; i <= n; i++) {
    const pos = total * minJerk(i / n);
    out.push({ dy: pos - prev, t: (i / n) * seconds });
    prev = pos;
  }
  return out;
}
