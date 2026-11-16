import { dijkstra } from "./dijkstra.ts";
import type { Graph, NodeId, ShortestPathResult } from "./graph.ts";
import { MinHeap } from "./heap.ts";

export type LandmarkPathResult = ShortestPathResult & {
  /** Queue removals that actually expand a node, including the target. */
  settledNodes: number;
};

export type LandmarkIndex = {
  /** Immutable snapshot. Rebuild the index when road weights or topology change. */
  readonly graph: Graph;
  readonly landmarks: readonly NodeId[];
  /** Directed triangle-inequality lower bound, in the graph's weight units. */
  estimate(node: NodeId, target: NodeId): number;
  query(source: NodeId, target: NodeId): LandmarkPathResult;
};

function checkNode(node: number, n: number) {
  if (!Number.isInteger(node) || node < 0 || node >= n)
    throw new RangeError("node must be an integer within the graph");
}

/**
 * ALT: A*, landmarks and triangle inequalities (Goldberg & Harrelson, 2005).
 * Stores both d(L,v) and d(v,L), so one-way roads use directed lower bounds.
 * Preprocessing costs 2k Dijkstra searches and O(kV + E) memory; k defaults to
 * four (maximum 32). An explicit [] gives a Dijkstra baseline for diagnostics.
 *
 * The index owns a frozen copy, including coordinates/geometry, and hides its
 * distance tables. Updating the source graph cannot silently invalidate it.
 */
export function buildLandmarkIndex(
  input: Graph,
  options: { landmarkCount?: number; landmarks?: readonly NodeId[] } = {},
): LandmarkIndex {
  const n = input.nodeCount;
  if (!Number.isInteger(n) || n < 0 || input.adjacency.length !== n)
    throw new RangeError("invalid graph node count or adjacency length");
  const count = options.landmarkCount ?? Math.min(4, n);
  if (!Number.isInteger(count) || count < 0 || count > 32)
    throw new RangeError("landmarkCount must be an integer between 0 and 32");
  if (options.landmarks && options.landmarkCount !== undefined)
    throw new Error("choose landmarks or landmarkCount, not both");
  const requested = options.landmarks ? [...options.landmarks] : null;
  if (
    requested &&
    (requested.length > 32 || new Set(requested).size !== requested.length)
  )
    throw new RangeError("provide at most 32 distinct landmarks");
  for (const node of requested ?? []) checkNode(node, n);
  const copyPoint = (point: { latitude: number; longitude: number }) =>
    Object.freeze({ ...point });
  if (input.coordinates && input.coordinates.length !== n)
    throw new RangeError("graph coordinates must match node count");
  const graph: Graph = {
    nodeCount: n,
    adjacency: input.adjacency.map((edges) => {
      const copied = edges.map((edge) => {
        checkNode(edge.to, n);
        if (!Number.isFinite(edge.weight) || edge.weight < 0)
          throw new RangeError("edge weights must be finite and nonnegative");
        const coordinates = edge.coordinates?.map(copyPoint);
        if (coordinates) Object.freeze(coordinates);
        return Object.freeze({ ...edge, coordinates });
      });
      Object.freeze(copied);
      return copied;
    }),
    coordinates: input.coordinates?.map(copyPoint),
  };
  Object.freeze(graph.adjacency);
  if (graph.coordinates) Object.freeze(graph.coordinates);
  Object.freeze(graph);
  const reverse: Graph = {
    nodeCount: n,
    adjacency: Array.from({ length: n }, () => []),
  };
  for (let u = 0; u < n; u++)
    for (const edge of graph.adjacency[u])
      reverse.adjacency[edge.to].push({ to: u, weight: edge.weight });

  const landmarks: number[] = [];
  const from: number[][] = [];
  const to: number[][] = [];
  const nearest = new Float64Array(n).fill(Infinity);
  const limit = requested?.length ?? Math.min(count, n);
  const selected = new Set<number>();
  for (let i = 0; i < limit; i++) {
    // Deterministic farthest-first selection; disconnected components are
    // selected before already covered nodes. No geographic units assumed.
    let landmark = requested?.[i] ?? -1;
    if (landmark < 0)
      for (let v = 0; v < n; v++)
        if (
          !selected.has(v) &&
          (landmark < 0 || nearest[v] > nearest[landmark])
        )
          landmark = v;
    landmarks.push(landmark);
    selected.add(landmark);
    const forward = dijkstra(graph, landmark).distances;
    const backward = dijkstra(reverse, landmark).distances;
    from.push(forward);
    to.push(backward);
    for (let v = 0; v < n; v++)
      nearest[v] = Math.min(nearest[v], forward[v], backward[v]);
  }
  const bound = (node: number, target: number) => {
    let best = 0;
    for (let i = 0; i < landmarks.length; i++) {
      // Never subtract infinities: disconnected components contribute no bound.
      if (Number.isFinite(from[i][target]) && Number.isFinite(from[i][node]))
        best = Math.max(best, from[i][target] - from[i][node]);
      if (Number.isFinite(to[i][node]) && Number.isFinite(to[i][target]))
        best = Math.max(best, to[i][node] - to[i][target]);
    }
    return best;
  };
  return Object.freeze({
    graph,
    landmarks: Object.freeze(landmarks),
    estimate(node: number, target: number) {
      checkNode(node, n);
      checkNode(target, n);
      return bound(node, target);
    },
    query(source: number, target: number): LandmarkPathResult {
      checkNode(source, n);
      checkNode(target, n);
      const distance = new Float64Array(n).fill(Infinity);
      const previous = new Int32Array(n).fill(-1);
      const score = new Float64Array(n).fill(Infinity);
      const done = new Uint8Array(n);
      const heap = new MinHeap();
      distance[source] = 0;
      score[source] = bound(source, target);
      heap.push(score[source], source);
      let settledNodes = 0;
      while (heap.pop()) {
        const u = heap.lastNode;
        if (done[u] || heap.lastKey > score[u]) continue;
        settledNodes++;
        if (u === target) {
          const path: number[] = [];
          for (let v = target; v !== -1; v = previous[v]) path.push(v);
          path.reverse();
          return { distance: distance[target], path, settledNodes };
        }
        done[u] = 1;
        for (const edge of graph.adjacency[u]) {
          const candidate = distance[u] + edge.weight;
          if (candidate >= distance[edge.to]) continue;
          distance[edge.to] = candidate;
          previous[edge.to] = u;
          score[edge.to] = candidate + bound(edge.to, target);
          // Missing bounds in disconnected directed graphs can be inconsistent.
          // Reopening retains optimality for these admissible lower bounds.
          done[edge.to] = 0;
          heap.push(score[edge.to], edge.to);
        }
      }
      return { distance: Infinity, path: [], settledNodes };
    },
  });
}
