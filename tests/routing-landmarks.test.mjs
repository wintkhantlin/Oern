import assert from "node:assert/strict";
import test from "node:test";
import { shortestPath } from "../src/lib/delivery/routing/dijkstra.ts";
import { addEdge, createGraph } from "../src/lib/delivery/routing/graph.ts";
import { buildLandmarkIndex } from "../src/lib/delivery/routing/landmarks.ts";
import { shortestPathBetween } from "../src/lib/delivery/routing/matrix.ts";

function assertPath(graph, result, source, target) {
  if (!Number.isFinite(result.distance)) {
    assert.deepEqual(result.path, []);
    return;
  }
  assert.equal(result.path[0], source);
  assert.equal(result.path.at(-1), target);
  let cost = 0;
  for (let i = 1; i < result.path.length; i++) {
    const weights = graph.adjacency[result.path[i - 1]]
      .filter((edge) => edge.to === result.path[i])
      .map((edge) => edge.weight);
    assert.ok(weights.length > 0, "path uses existing directed edges");
    cost += Math.min(...weights);
  }
  assert.equal(cost, result.distance);
}

test("directed landmark bounds and reconstructed paths agree with Dijkstra", () => {
  let state = 271828;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  for (let sample = 0; sample < 45; sample++) {
    const n = 3 + Math.floor(random() * 14);
    const graph = createGraph(n);
    for (let i = 0; i < n * 3; i++) {
      const u = Math.floor(random() * n);
      const v = Math.floor(random() * n);
      // Include zero weights, self-loops and parallel edges; connectivity is
      // intentionally not guaranteed, and every edge is directed.
      addEdge(graph, u, v, Math.floor(random() * 16), undefined, true);
    }
    const index = buildLandmarkIndex(graph);
    assert.deepEqual(index.landmarks, buildLandmarkIndex(graph).landmarks);
    for (let source = 0; source < n; source++) {
      for (let target = 0; target < n; target++) {
        const expected = shortestPath(graph, source, target).distance;
        const lower = index.estimate(source, target);
        assert.ok(Number.isFinite(lower) && lower >= 0);
        assert.ok(
          lower <= expected,
          `admissible bound for ${source}->${target}`,
        );
        const result = index.query(source, target);
        assert.equal(
          result.distance,
          expected,
          `exact path ${source}->${target}`,
        );
        assertPath(graph, result, source, target);
      }
    }
  }
});

test("one-way and disconnected landmark distances do not produce NaN bounds", () => {
  const graph = createGraph(5);
  addEdge(graph, 0, 1, 2, undefined, true);
  addEdge(graph, 1, 2, 3, undefined, true);
  addEdge(graph, 3, 4, 0, undefined, true);
  const index = buildLandmarkIndex(graph, { landmarks: [0, 2, 4] });
  assert.equal(index.estimate(0, 2), 5);
  assert.equal(index.query(0, 2).distance, 5);
  assert.deepEqual(index.query(2, 0).path, []);
  assert.equal(index.query(3, 4).distance, 0);
  assert.equal(index.query(0, 4).distance, Infinity);
  assert.equal(index.query(4, 4).distance, 0);
});

test("directed missing bounds permit a previously expanded dead end to reopen", () => {
  const graph = createGraph(4);
  addEdge(graph, 0, 2, 10, undefined, true);
  addEdge(graph, 0, 1, 1, undefined, true);
  addEdge(graph, 1, 2, 1, undefined, true);
  addEdge(graph, 1, 3, 10, undefined, true);
  const index = buildLandmarkIndex(graph, { landmarks: [3] });
  // Node 2 cannot reach landmark/target 3, so it contributes no bound.
  // It is expanded at cost 10 before node 1, then reopened at cost 2.
  assert.equal(index.estimate(1, 3), 10);
  assert.equal(index.estimate(2, 3), 0);
  const result = index.query(0, 3);
  assert.equal(result.distance, shortestPath(graph, 0, 3).distance);
  assert.deepEqual(result.path, [0, 1, 3]);
  assert.equal(result.settledNodes, 5);
});

test("ALT expands fewer road branches while preserving optimal path cost", () => {
  const mainNodes = 100;
  const branches = 20;
  const graph = createGraph(mainNodes * (branches + 1));
  for (let u = 0; u < mainNodes; u++) {
    if (u + 1 < mainNodes) addEdge(graph, u, u + 1, 1);
    for (let b = 0; b < branches; b++)
      addEdge(graph, u, mainNodes + u * branches + b, 0.25);
  }
  const baseline = buildLandmarkIndex(graph, { landmarks: [] }).query(0, 99);
  const accelerated = buildLandmarkIndex(graph, { landmarks: [99] }).query(
    0,
    99,
  );
  assert.equal(accelerated.distance, baseline.distance);
  assertPath(graph, accelerated, 0, 99);
  assert.equal(accelerated.settledNodes, mainNodes);
  assert.ok(accelerated.settledNodes * 10 < baseline.settledNodes);
});

test("prepared metrics and geometry are insulated from source graph changes", () => {
  const a = { latitude: 16.8, longitude: 96.1 };
  const b = { latitude: 16.81, longitude: 96.1 };
  const graph = createGraph(2, [a, b]);
  const geometry = [a, b];
  addEdge(graph, 0, 1, 100, geometry);
  const index = buildLandmarkIndex(graph);
  graph.adjacency[0][0].weight = 1;
  geometry[0].latitude = 17;
  addEdge(graph, 0, 1, 0);
  assert.equal(index.query(0, 1).distance, 100);
  assert.equal(index.graph.coordinates[0].latitude, 16.8);
  assert.equal(index.graph.adjacency[0][0].coordinates[0].latitude, 16.8);
  assert.throws(() => {
    index.graph.adjacency[0][0].weight = 3;
  }, TypeError);
  assert.throws(() => {
    index.graph.adjacency[0].push({ to: 1, weight: 3 });
  }, TypeError);
  assert.throws(() => {
    index.landmarks[0] = 1;
  }, TypeError);
  assert.equal(buildLandmarkIndex(graph).query(0, 1).distance, 0);
});

test("geographic routing accepts only the prepared metric snapshot", () => {
  const coordinates = [
    { latitude: 16.8, longitude: 96.1 },
    { latitude: 16.81, longitude: 96.1 },
  ];
  const graph = createGraph(2, coordinates);
  addEdge(graph, 0, 1, 1000);
  const index = buildLandmarkIndex(graph);
  const options = { landmarks: index };
  assert.throws(
    () =>
      shortestPathBetween(graph, coordinates[0], coordinates[1], 1, options),
    /index.graph snapshot/,
  );
  const result = shortestPathBetween(
    index.graph,
    coordinates[0],
    coordinates[1],
    1,
    options,
  );
  assert.equal(result.distance, 1000);
  assert.deepEqual(result.path, [0, 1]);
  const offNetwork = shortestPathBetween(
    index.graph,
    { latitude: 0, longitude: 0 },
    coordinates[1],
    1,
    options,
  );
  assert.equal(offNetwork.distance, Infinity);
  assert.deepEqual(offNetwork.path, []);
});

test("landmark preparation validates graph weights, nodes and bounded options", () => {
  const graph = createGraph(2);
  assert.throws(
    () => buildLandmarkIndex(graph, { landmarkCount: 33 }),
    RangeError,
  );
  assert.throws(
    () => buildLandmarkIndex(graph, { landmarkCount: 1.5 }),
    RangeError,
  );
  assert.throws(
    () => buildLandmarkIndex(graph, { landmarks: [0, 0] }),
    RangeError,
  );
  assert.throws(
    () => buildLandmarkIndex(graph, { landmarks: [2] }),
    RangeError,
  );
  assert.throws(() =>
    buildLandmarkIndex(graph, { landmarks: [0], landmarkCount: 1 }),
  );
  const index = buildLandmarkIndex(graph, { landmarkCount: 0 });
  assert.throws(() => index.query(-1, 0), RangeError);
  assert.throws(() => index.estimate(0, 2), RangeError);
  graph.adjacency[0].push({ to: 1, weight: -1 });
  assert.throws(() => buildLandmarkIndex(graph), /nonnegative/);
  graph.adjacency[0][0].weight = NaN;
  assert.throws(() => buildLandmarkIndex(graph), /finite/);
  graph.adjacency[0][0] = { to: 2, weight: 1 };
  assert.throws(() => buildLandmarkIndex(graph), RangeError);
  const empty = buildLandmarkIndex(createGraph(0));
  assert.deepEqual(empty.landmarks, []);
  assert.throws(() => empty.query(0, 0), RangeError);
});
