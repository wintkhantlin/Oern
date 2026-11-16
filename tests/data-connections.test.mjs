import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildStraightLineMatrix } from "../src/lib/delivery/dispatch/matrix.ts";
import { DEFAULT_PARAMS } from "../src/lib/delivery/dispatch/params.ts";
import {
  buildOsmGraph,
  buildOsmMatrix,
} from "../src/lib/delivery/dispatch/osm-matrix.ts";
import { applyTraffic, yutraPeriodAt } from "../src/lib/delivery/dispatch/traffic.ts";
import { YUTRA_CONGESTION } from "../src/lib/delivery/data/yutra-network.ts";
import { nearestFoodVendors } from "../src/lib/delivery/data/yangon-food-vendors.ts";

test("OSM matrix follows roads and one-way edges", () => {
  // A one-way triangle: 0 -> 1 -> 2 -> 0, each 1 km.
  const g = buildOsmGraph({
    nodes: [[16.8, 96.1], [16.809, 96.1], [16.809, 96.109]],
    edges: [[0, 1, 1000, 1], [1, 2, 1000, 1], [2, 0, 1000, 1]],
  });
  const pts = [
    { lat: 16.8, lng: 96.1 },
    { lat: 16.809, lng: 96.109 },
  ];
  const { matrix, snapped } = buildOsmMatrix(g, pts, DEFAULT_PARAMS);
  assert.equal(snapped, 2);
  assert.equal(matrix.source, "road_matrix");
  assert.ok(Math.abs(matrix.km[1] - 2) < 1e-6); // 0 -> 2 goes the long way
  assert.ok(Math.abs(matrix.km[2] - 1) < 1e-6); // 2 -> 0 direct
});

test("generated OSM graph exists and is routable", () => {
  const raw = JSON.parse(
    readFileSync("data/generated/yangon-road-graph.json", "utf8"),
  );
  const g = buildOsmGraph(raw);
  assert.ok(g.n > 50_000);
  const pts = [
    { lat: 16.8661, lng: 96.1951 }, // Sule
    { lat: 16.852, lng: 96.198 }, // Pyay / Inya
  ];
  const { matrix, snapped } = buildOsmMatrix(g, pts, DEFAULT_PARAMS);
  assert.equal(snapped, 2);
  const straight = buildStraightLineMatrix(pts, DEFAULT_PARAMS);
  assert.ok(matrix.km[1] > 1 && matrix.km[1] < straight.km[1] * 3);
});

test("YUTRA congestion adds queueing delay only inside surveyed windows", () => {
  const sule = YUTRA_CONGESTION.find((c) => c.name.startsWith("Sule") && c.period === "peak");
  assert.ok(sule && sule.level === "high");
  const pts = [
    { lat: sule.latitude - 0.004, lng: sule.longitude },
    { lat: sule.latitude + 0.004, lng: sule.longitude },
  ];
  const base = buildStraightLineMatrix(pts, DEFAULT_PARAMS);
  const yangon = (h, m) => Date.UTC(2026, 10, 16, h, m) - 6.5 * 3_600_000;
  const off = { measuredSignals: [] };
  const peak = applyTraffic(base, pts, { ...off, nowMs: yangon(8, 0) });
  const night = applyTraffic(base, pts, { ...off, nowMs: yangon(22, 0) });
  assert.equal(yutraPeriodAt(yangon(8, 0)), "peak");
  assert.equal(yutraPeriodAt(yangon(22, 0)), null);
  assert.ok((peak.summary.congestedJunctionsUsed ?? 0) >= 1);
  assert.equal(night.summary.congestedJunctionsUsed, 0);
  assert.ok(peak.matrix.time[1] > night.matrix.time[1] + 1);
});

test("nearestFoodVendors sorts by distance", () => {
  const r = nearestFoodVendors(16.8661, 96.1951, 3);
  assert.equal(r.length, 3);
  assert.ok(r[0].km <= r[1].km && r[1].km <= r[2].km);
});
