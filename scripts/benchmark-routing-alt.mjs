import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { shortestPath } from "../src/lib/delivery/routing/dijkstra.ts";
import { addEdge, createGraph } from "../src/lib/delivery/routing/graph.ts";
import { buildLandmarkIndex } from "../src/lib/delivery/routing/landmarks.ts";

// Local smoke benchmark, not a production performance guarantee.
// Run: node --experimental-strip-types scripts/benchmark-routing-alt.mjs
const raw = JSON.parse(
  readFileSync(
    new URL("../data/generated/yangon-road-graph.json", import.meta.url),
    "utf8",
  ),
);
const graph = createGraph(raw.nodes.length);
for (const [from, to, metres, oneway] of raw.edges)
  addEdge(graph, from, to, metres, undefined, Boolean(oneway));
const started = performance.now();
const index = buildLandmarkIndex(graph);
const preprocessingMs = performance.now() - started;
let seed = 20261116;
const nextNode = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed % graph.nodeCount;
};
let dijkstraMs = 0;
let altMs = 0;
let settledNodes = 0;
let reachable = 0;
const queries = 12;
for (let i = 0; i < queries; i++) {
  const source = nextNode();
  const target = nextNode();
  let start = performance.now();
  const expected = shortestPath(graph, source, target);
  dijkstraMs += performance.now() - start;
  start = performance.now();
  const actual = index.query(source, target);
  altMs += performance.now() - start;
  settledNodes += actual.settledNodes;
  assert.ok(
    actual.distance === expected.distance ||
      Math.abs(actual.distance - expected.distance) <= 1e-6,
    `cost mismatch for ${source} -> ${target}`,
  );
  if (!Number.isFinite(actual.distance)) {
    assert.deepEqual(actual.path, []);
    continue;
  }
  reachable++;
  assert.equal(actual.path[0], source);
  assert.equal(actual.path.at(-1), target);
  let pathCost = 0;
  for (let j = 1; j < actual.path.length; j++) {
    pathCost += Math.min(
      ...graph.adjacency[actual.path[j - 1]]
        .filter((edge) => edge.to === actual.path[j])
        .map((edge) => edge.weight),
    );
  }
  assert.ok(Math.abs(pathCost - actual.distance) <= 1e-6, "path cost mismatch");
}
console.log(
  JSON.stringify(
    {
      nodes: graph.nodeCount,
      storedEdges: raw.edges.length,
      landmarks: index.landmarks,
      queries,
      reachable,
      preprocessingMs,
      dijkstraMs,
      altMs,
      settledNodes,
    },
    null,
    2,
  ),
);
