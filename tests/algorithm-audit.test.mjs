import assert from "node:assert/strict";
import test from "node:test";
import { lowerBound } from "../src/lib/delivery/dispatch/bounds.ts";
import { exactOptimum } from "../src/lib/delivery/dispatch/exact.ts";
import {
  buildStraightLineMatrix,
  nodePoints,
} from "../src/lib/delivery/dispatch/matrix.ts";
import { generateSynthetic } from "../src/lib/delivery/dispatch/synthetic.ts";
import { aStar } from "../src/lib/delivery/routing/astar.ts";
import {
  chQuery,
  contractGraph,
} from "../src/lib/delivery/routing/contraction-hierarchies.ts";
import {
  bidirectionalDijkstra,
  shortestPath,
} from "../src/lib/delivery/routing/dijkstra.ts";
import { addEdge, createGraph } from "../src/lib/delivery/routing/graph.ts";
import { buildShortestPathMatrix } from "../src/lib/delivery/routing/matrix.ts";

function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

test("lower bound stays below the exact optimum with clustered and far orders", () => {
  for (const penalty of [60, 200, 600]) {
    for (let seed = 1; seed <= 40; seed++) {
      const inst = generateSynthetic({
        seed,
        orders: 4,
        trucks: 2,
        depotShare: 0.3,
        params: { unservedPenalty: penalty },
      });
      // Cluster two orders on one spot and push one far away.
      inst.requests[1].delivery = { ...inst.requests[0].delivery };
      if (seed % 2) {
        inst.requests[3].delivery = {
          lat: inst.depot.lat + 0.6,
          lng: inst.depot.lng + 0.6,
        };
      }
      const matrix = buildStraightLineMatrix(nodePoints(inst), inst.params);
      const { optimum } = exactOptimum(inst, matrix);
      const bound = lowerBound(inst, matrix).value;
      assert.ok(
        bound <= optimum + 1e-6,
        `penalty ${penalty} seed ${seed}: bound ${bound} > optimum ${optimum}`,
      );
    }
  }
});

test("lower bound does not mark reachable orders unservable because of the cost term", () => {
  const inst = generateSynthetic({
    seed: 3,
    orders: 3,
    trucks: 1,
    depotShare: 0,
  });
  for (const request of inst.requests) request.windowEnd = 1e9;
  const matrix = buildStraightLineMatrix(nodePoints(inst), inst.params);
  inst.requests[0].windowEnd = inst.params.shiftStart + 1e6;
  const bound = lowerBound(inst, matrix);
  const { optimum } = exactOptimum(inst, matrix);
  assert.ok(bound.value <= optimum + 1e-6);
  assert.ok(bound.value < inst.requests.length * inst.params.unservedPenalty);
});

function randomGraph(rnd, n, directed) {
  const g = createGraph(n);
  const m = Math.floor(rnd() * n * 3);
  for (let e = 0; e < m; e++) {
    const a = Math.floor(rnd() * n);
    const b = Math.floor(rnd() * n);
    if (a === b) continue;
    addEdge(
      g,
      a,
      b,
      Math.floor(rnd() * 20),
      undefined,
      directed && rnd() < 0.5,
    );
  }
  return g;
}

test("dijkstra, bidirectional, a* and CH agree on random graphs", () => {
  const rnd = rng(12345);
  for (let it = 0; it < 150; it++) {
    const n = 3 + Math.floor(rnd() * 12);
    const g = randomGraph(rnd, n, true);
    const ch = contractGraph(g);
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
        const d = a === b ? 0 : shortestPath(g, a, b).distance;
        assert.equal(
          bidirectionalDijkstra(g, a, b).distance,
          d,
          `bidi ${a}->${b}`,
        );
        assert.equal(aStar(g, a, b, () => 0).distance, d, `astar ${a}->${b}`);
        assert.equal(chQuery(ch, a, b), d, `ch ${a}->${b}`);
        const bi = bidirectionalDijkstra(g, a, b);
        if (Number.isFinite(d)) {
          assert.equal(bi.path[0], a);
          assert.equal(bi.path.at(-1), b);
        }
      }
    }
  }
});

test("contraction hierarchy query really uses the hierarchy for small graphs", () => {
  const rnd = rng(99);
  const g = randomGraph(rnd, 12, true);
  const ch = contractGraph(g);
  assert.equal(ch.graph, undefined);
  assert.equal(chQuery(ch, 0, 5), shortestPath(g, 0, 5).distance);
});

test("shortest paths scale to a 20k-node grid without stack errors", () => {
  const W = 142;
  const g = createGraph(W * W);
  for (let y = 0; y < W; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (x + 1 < W) addEdge(g, i, i + 1, 100);
      if (y + 1 < W) addEdge(g, i, i + W, 100);
    }
  const t = Date.now();
  const last = W * W - 1;
  const d = shortestPath(g, 0, last).distance;
  assert.equal(d, 100 * 2 * (W - 1));
  assert.equal(bidirectionalDijkstra(g, 0, last).distance, d);
  assert.equal(aStar(g, 0, last, () => 0).distance, d);
  assert.ok(Date.now() - t < 5000);
});

test("matrix over a big graph skips contraction and prices snap offsets", () => {
  const W = 80;
  const coords = [];
  for (let y = 0; y < W; y++)
    for (let x = 0; x < W; x++)
      coords.push({
        latitude: 16.7 + y * 0.0009,
        longitude: 96.1 + x * 0.0009,
      });
  const g = createGraph(W * W, coords);
  for (let y = 0; y < W; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (x + 1 < W) addEdge(g, i, i + 1, 100);
      if (y + 1 < W) addEdge(g, i, i + W, 100);
    }
  const params = {
    speedKmh: 20,
    truckTimeFactor: 1,
    trafficMultiplier: 1,
    roadFactor: 1.2,
  };
  const t = Date.now();
  const pts = [
    { lat: 16.7, lng: 96.1 },
    { lat: 16.70001, lng: 96.10001 }, // same node as point 0
    { lat: 16.7 + 40 * 0.0009, lng: 96.1 + 40 * 0.0009 },
    { lat: 17.5, lng: 97.5 }, // far off the network
  ];
  const m = buildShortestPathMatrix(g, pts, params);
  assert.ok(Date.now() - t < 3000);
  assert.ok(m.km[1] > 0, "same-node points are not free");
  assert.ok(Math.abs(m.km[2] - 8) < 1e-6); // 80 edges x 100 m
  assert.ok(m.km[3] > 100, "off-network point falls back to straight line");
  // time is minutes: 8 km at 20 km/h = 24 min
  assert.ok(Math.abs(m.time[2] - 24) < 1e-6);
  assert.equal(m.source, "road_calibrated");
});

test("exact duplicate coordinates remain a zero-cost leg after snapping", () => {
  const g = createGraph(2, [
    { latitude: 16.8, longitude: 96.1 },
    { latitude: 16.81, longitude: 96.1 },
  ]);
  addEdge(g, 0, 1, 1000);
  const points = [
    { lat: 16.8005, lng: 96.1002 },
    { lat: 16.8005, lng: 96.1002 },
  ];
  const params = {
    speedKmh: 20,
    roadFactor: 1.2,
    truckTimeFactor: 1,
    trafficMultiplier: 1,
  };
  const regular = buildShortestPathMatrix(g, points, params);
  assert.equal(regular.km[1], 0);
  assert.equal(regular.time[1], 0);

  const osm = buildOsmMatrix(
    osmLine(),
    [
      { lat: 16.8045, lng: 96.1 },
      { lat: 16.8045, lng: 96.1 },
    ],
    DEFAULT_PARAMS,
  ).matrix;
  assert.equal(osm.km[1], 0);
  assert.equal(osm.time[1], 0);
});

import {
  buildOsmGraph,
  buildOsmMatrix,
  snapNode,
} from "../src/lib/delivery/dispatch/osm-matrix.ts";
import { DEFAULT_PARAMS } from "../src/lib/delivery/dispatch/params.ts";

function osmLine() {
  // Two nodes 1 km apart on a street.
  return buildOsmGraph({
    nodes: [
      [16.8, 96.1],
      [16.809, 96.1],
    ],
    edges: [[0, 1, 1000, 0]],
  });
}

test("OSM matrix: points sharing a node are not free and offsets are priced", () => {
  const g = osmLine();
  const pts = [
    { lat: 16.8, lng: 96.1 },
    { lat: 16.8, lng: 96.1005 }, // ~53 m away, same node
    { lat: 16.809, lng: 96.1 + 0.0105 }, // ~1.1 km from node 1
  ];
  const { matrix, coverage } = buildOsmMatrix(g, pts, DEFAULT_PARAMS);
  assert.ok(matrix.km[1] > 0.04 && matrix.time[1] > 0);
  assert.ok(matrix.km[2] > 1 + 1.0, "snap leg adds distance");
  assert.equal(coverage, 1);
  assert.equal(matrix.source, "road_matrix");
});

test("OSM matrix: unreachable pairs are counted and not labelled road_matrix", () => {
  const g = buildOsmGraph({
    nodes: [
      [16.8, 96.1],
      [16.809, 96.1],
      [16.82, 96.1],
    ],
    edges: [[0, 1, 1000, 0]], // node 2 is isolated
  });
  const pts = [
    { lat: 16.8, lng: 96.1 },
    { lat: 16.809, lng: 96.1 },
    { lat: 16.82, lng: 96.1 },
  ];
  const r = buildOsmMatrix(g, pts, DEFAULT_PARAMS);
  assert.equal(r.realPairs, 2);
  assert.equal(r.totalPairs, 6);
  assert.equal(r.matrix.source, "road_calibrated");
  assert.ok(r.matrix.km[2] > 2); // straight-line fallback for the pair
});

test("OSM snap grid agrees with a brute-force scan", () => {
  const rnd = rng(5);
  const nodes = Array.from({ length: 500 }, () => [
    16.7 + rnd() * 0.3,
    96.0 + rnd() * 0.3,
  ]);
  const g = buildOsmGraph({ nodes, edges: [] });
  for (let k = 0; k < 100; k++) {
    const p = { lat: 16.65 + rnd() * 0.4, lng: 95.95 + rnd() * 0.4 };
    let best = -1;
    let bestD = Infinity;
    const cos = Math.cos((p.lat * Math.PI) / 180);
    nodes.forEach(([a, b], i) => {
      const d = Math.hypot((a - p.lat) * 111.2, (b - p.lng) * 111.2 * cos);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    const got = snapNode(g, p, 1000);
    assert.equal(got, best);
  }
  assert.equal(snapNode(g, { lat: 10, lng: 90 }, 1.5), null);
});

import { solve } from "../src/lib/delivery/dispatch/solve.ts";
import { validateSolution } from "../src/lib/delivery/dispatch/validate.ts";

test("solver leaves out orders that cost more than the unserved penalty", () => {
  for (const penalty of [30, 60, 200, 600]) {
    let worst = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const inst = generateSynthetic({
        seed,
        orders: 5,
        trucks: 2,
        depotShare: 0.3,
        params: { unservedPenalty: penalty },
      });
      const matrix = buildStraightLineMatrix(nodePoints(inst), inst.params);
      const plan = solve(inst, matrix, { nowMs: () => 0 });
      assert.deepEqual(validateSolution(inst, matrix, plan), []);
      const { optimum } = exactOptimum(inst, matrix);
      assert.ok(plan.objective.total >= optimum - 1e-6);
      worst = Math.max(
        worst,
        ((plan.objective.total - optimum) / optimum) * 100,
      );
    }
    assert.ok(worst < 10, `penalty ${penalty}: worst gap ${worst.toFixed(1)}%`);
  }
});

import { applyTrafficSignals } from "../src/lib/delivery/routing/traffic.ts";
import { signalDelayMin } from "../src/lib/delivery/signal-index.ts";

test("a signal beside a shared node is charged once, in minutes not inflated", () => {
  const A = { latitude: 16.8, longitude: 96.1 };
  const B = { latitude: 16.8, longitude: 96.105 };
  const C = { latitude: 16.8, longitude: 96.11 };
  const g = createGraph(3, [A, B, C]);
  addEdge(g, 0, 1, 500, [A, B]);
  addEdge(g, 1, 2, 500, [B, C]);
  const signal = { ...B, estimatedCycleSeconds: 90 };
  const out = applyTrafficSignals(g, [signal], 20, 0.045, 1.5);
  const total = (path) =>
    path.reduce(
      (sum, [u, v]) => sum + out.adjacency[u].find((e) => e.to === v).weight,
      0,
    );
  const extraMetres =
    total([
      [0, 1],
      [1, 2],
    ]) - 1000;
  const expectedMetres = (signalDelayMin(90) * (20 / 60) * 1000) / 1.5;
  assert.ok(Math.abs(extraMetres - expectedMetres) < 1e-6);
  // Both directions of the physical segment carry the same delay.
  assert.equal(
    total([
      [2, 1],
      [1, 0],
    ]),
    total([
      [0, 1],
      [1, 2],
    ]),
  );
  // Idempotent.
  const again = applyTrafficSignals(out, [signal], 20, 0.045, 1.5);
  assert.deepEqual(again.adjacency, out.adjacency);
});
