import assert from "node:assert/strict";
import test from "node:test";
import { certify, lowerBound } from "../src/lib/delivery/dispatch/bounds.ts";
import { exactOptimum } from "../src/lib/delivery/dispatch/exact.ts";
import {
  buildStraightLineMatrix,
  nodePoints,
} from "../src/lib/delivery/dispatch/matrix.ts";
import { solve } from "../src/lib/delivery/dispatch/solve.ts";
import { generateSynthetic } from "../src/lib/delivery/dispatch/synthetic.ts";
import { validateSolution } from "../src/lib/delivery/dispatch/validate.ts";

const clock = () => 0;
const SEEDS = Array.from({ length: 24 }, (_, i) => i + 1);

// The planner serves every feasible parcel rather than declining costly ones, so
// benchmark with a penalty high enough that the optimum also serves them all.
// That makes the comparison measure routing quality alone.
function build(seed, orders, trucks) {
  const inst = generateSynthetic({
    seed,
    orders,
    trucks,
    depotShare: 0.3,
    params: { unservedPenalty: 1e6 },
  });
  const matrix = buildStraightLineMatrix(nodePoints(inst), inst.params);
  return { inst, matrix };
}

test("lower bound never exceeds the exact optimum (validity)", () => {
  for (const seed of SEEDS) {
    const { inst, matrix } = build(seed, 4, 2);
    const { optimum } = exactOptimum(inst, matrix);
    const bound = lowerBound(inst, matrix).value;
    assert.ok(
      bound <= optimum + 1e-6,
      `seed ${seed}: bound ${bound} > optimum ${optimum}`,
    );
  }
});

test("the solver never beats the exact optimum and stays near it", () => {
  const gaps = [];
  for (const seed of SEEDS) {
    const { inst, matrix } = build(seed, 4, 2);
    const plan = solve(inst, matrix, { nowMs: clock });
    assert.deepEqual(validateSolution(inst, matrix, plan), []);
    const { optimum } = exactOptimum(inst, matrix);
    assert.ok(
      plan.objective.total >= optimum - 1e-6,
      `seed ${seed}: solver ${plan.objective.total} < optimum ${optimum}`,
    );
    const cert = certify(inst, matrix, plan, optimum);
    assert.ok(cert.lowerBound <= cert.objective + 1e-6);
    gaps.push(cert.exactGapPct ?? 0);
  }
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const worst = Math.max(...gaps);
  console.log(
    `exact gap over ${gaps.length} instances: mean ${mean.toFixed(3)}%, worst ${worst.toFixed(3)}%`,
  );
  assert.ok(mean < 1, `mean gap ${mean}`);
  assert.ok(worst < 5, `worst gap ${worst}`);
});

test("the same seed always gives the same plan (reproducibility)", () => {
  const { inst, matrix } = build(9, 12, 3);
  const a = solve(inst, matrix, { nowMs: clock });
  const b = solve(inst, matrix, { nowMs: clock });
  assert.equal(a.hash, b.hash);
});

test("lower bound is valid on larger instances (never above the plan)", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const { inst, matrix } = build(seed, 25, 4);
    const plan = solve(inst, matrix, { nowMs: clock });
    assert.ok(lowerBound(inst, matrix).value <= plan.objective.total + 1e-6);
  }
});

test("data source registry never claims an unused source feeds the planner", async () => {
  const { describeSources } =
    await import("../src/lib/delivery/dispatch/data-sources.ts");
  const sources = describeSources({
    mapboxToken: false,
    supabase: false,
    anthropicKey: false,
    yutraSignals: 0,
    yutraRawFiles: 0,
    osmExtractMb: 11,
    trafficPoints: 89,
    fuelStations: 64,
    foodVendors: 16,
    interceptionPoints: 90,
  });
  const byId = Object.fromEntries(sources.map((s) => [s.id, s]));
  assert.equal(byId["mapbox-matrix"].state, "missing");
  assert.equal(byId["yutra-signals"].state, "missing");
  // Without the built data these stay honest: available, not used.
  assert.equal(byId["yutra-rest"].usedByPlanner, false);
  assert.equal(byId.osm.usedByPlanner, false);
  const wired = Object.fromEntries(
    describeSources({
      mapboxToken: false, supabase: false, anthropicKey: false,
      yutraSignals: 7, yutraRawFiles: 7, yutraCongestion: 14,
      osmExtractMb: 11, osmGraphNodes: 1000, trafficPoints: 89,
      fuelStations: 64, foodVendors: 16, interceptionPoints: 90,
    }).map((s) => [s.id, s]),
  );
  assert.equal(wired.osm.state, "active");
  assert.equal(wired.osm.usedByPlanner, true);
  assert.equal(wired["yutra-rest"].usedByPlanner, true);
  assert.equal(wired.vendors.state, "active");
  for (const s of sources)
    if (!s.usedByPlanner) assert.notEqual(s.state, "active-and-fed");
});

test("a measured signal with no modelled counterpart adds exactly its measured delay", async () => {
  const { applyTraffic } =
    await import("../src/lib/delivery/dispatch/traffic.ts");
  const { DEFAULT_PARAMS } =
    await import("../src/lib/delivery/dispatch/params.ts");
  // Far outside Yangon, so no modelled signal or hand-mapped point is nearby.
  const points = [
    { lat: 17.6, lng: 96.1 },
    { lat: 17.62, lng: 96.1 },
  ];
  const base = buildStraightLineMatrix(points, DEFAULT_PARAMS);
  const signal = {
    id: "t",
    name: "T",
    township: "T",
    latitude: 17.61,
    longitude: 96.1,
    cycleSeconds: 90,
    meanDelaySeconds: 30,
    dataType: "observed",
    confidence: "verified",
    surveyYear: 2013,
    sourcePage: "x",
    tableId: "x",
  };
  const off = applyTraffic(base, points, { measuredSignals: [] });
  const on = applyTraffic(base, points, { measuredSignals: [signal] });
  assert.equal(off.summary.measuredSignalsUsed, 0);
  assert.equal(on.summary.measuredSignalsUsed, 1);
  assert.ok(Math.abs(on.matrix.time[1] - off.matrix.time[1] - 0.5) < 1e-9);
  assert.ok(Math.abs(on.matrix.time[2] - off.matrix.time[2] - 0.5) < 1e-9);
});

test("downtown surveyed signals fill a gap the model left, and replace it where it knew the junction", async () => {
  const { applyTraffic } =
    await import("../src/lib/delivery/dispatch/traffic.ts");
  const { DEFAULT_PARAMS } =
    await import("../src/lib/delivery/dispatch/params.ts");
  const { YUTRA_SIGNAL_DELAYS } =
    await import("../src/lib/delivery/data/yutra-signal-delays.ts");
  const { ALL_YANGON_INTERCEPTION_POINTS } =
    await import("../src/lib/delivery/data/yangon-interception-points.ts");
  const { signalCostMin } = await import("../src/lib/delivery/routing-cost.ts");
  const cross = (lat, lng) => {
    const points = [
      { lat: lat - 0.004, lng },
      { lat: lat + 0.004, lng },
    ];
    return { points, base: buildStraightLineMatrix(points, DEFAULT_PARAMS) };
  };

  // 1. Sule Square has no modelled signal within 4 km: the measurement is added.
  const sule = YUTRA_SIGNAL_DELAYS.find((s) => s.name.startsWith("Sule"));
  let { points, base } = cross(sule.latitude, sule.longitude);
  const off = applyTraffic(base, points, { measuredSignals: [] });
  const on = applyTraffic(base, points, { measuredSignals: [sule] });
  assert.equal(on.summary.measuredSignalsUsed, 1);
  assert.ok(
    Math.abs(
      on.matrix.time[1] - off.matrix.time[1] - sule.meanDelaySeconds / 60,
    ) < 1e-9,
  );

  // 2. At a hand-mapped light the measured delay replaces the modelled one.
  const bypassed = new Set(
    ALL_YANGON_INTERCEPTION_POINTS.map((p) => p.bypassesPointId).filter(
      Boolean,
    ),
  );
  const light = ALL_YANGON_INTERCEPTION_POINTS.find(
    (p) => p.type === "traffic_light" && !bypassed.has(p.id),
  );
  const surveyed = {
    ...sule,
    id: "test",
    latitude: light.latitude,
    longitude: light.longitude,
    meanDelaySeconds: 10,
  };
  ({ points, base } = cross(light.latitude, light.longitude));
  const modelled = applyTraffic(base, points, { measuredSignals: [] });
  const replaced = applyTraffic(base, points, { measuredSignals: [surveyed] });
  const expected =
    modelled.matrix.time[1] -
    signalCostMin(light.estimatedCycleSeconds) +
    10 / 60;
  assert.ok(Math.abs(replaced.matrix.time[1] - expected) < 1e-9);
});
