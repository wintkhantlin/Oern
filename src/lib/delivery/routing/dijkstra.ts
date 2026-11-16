import type { Graph, NodeId, ShortestPathResult } from "./graph.ts";
import { MinHeap } from "./heap.ts";

const INF = Number.POSITIVE_INFINITY;

export function dijkstra(
  graph: Graph,
  source: NodeId,
  target?: NodeId,
  /** Stop once every node in this set is settled (ignored when `target` is set). */
  targets?: ReadonlySet<NodeId>,
): { distances: number[]; previous: number[] } {
  const { nodeCount, adjacency } = graph;
  const distances = new Array<number>(nodeCount).fill(INF);
  const previous = new Array<number>(nodeCount).fill(-1);
  const done = new Uint8Array(nodeCount);
  const heap = new MinHeap();
  distances[source] = 0;
  heap.push(0, source);
  let pending = targets && target === undefined ? targets.size : -1;

  while (heap.pop()) {
    const u = heap.lastNode;
    if (done[u] || heap.lastKey > distances[u]) continue;
    if (target !== undefined && u === target) break;
    done[u] = 1;
    if (pending > 0 && targets?.has(u) && --pending === 0) break;
    for (const edge of adjacency[u]) {
      const alt = distances[u] + edge.weight;
      if (alt < distances[edge.to]) {
        distances[edge.to] = alt;
        previous[edge.to] = u;
        heap.push(alt, edge.to);
      }
    }
  }
  return { distances, previous };
}

export function shortestPath(
  graph: Graph,
  source: NodeId,
  target: NodeId,
): ShortestPathResult {
  const { distances, previous } = dijkstra(graph, source, target);
  if (!Number.isFinite(distances[target])) {
    return { distance: INF, path: [] };
  }
  const path: NodeId[] = [];
  let current = target;
  while (current !== -1) {
    path.unshift(current);
    if (current === source) break;
    current = previous[current];
  }
  return { distance: distances[target], path };
}

export function bidirectionalDijkstra(
  graph: Graph,
  source: NodeId,
  target: NodeId,
): ShortestPathResult {
  if (source === target) return { distance: 0, path: [source] };
  const { nodeCount, adjacency } = graph;
  // Reverse adjacency index for backward search.
  const reverseAdj: { from: number; weight: number }[][] = Array.from(
    { length: nodeCount },
    () => [],
  );
  for (let v = 0; v < nodeCount; v++) {
    for (const edge of adjacency[v]) {
      reverseAdj[edge.to].push({ from: v, weight: edge.weight });
    }
  }
  const distF = new Array<number>(nodeCount).fill(INF);
  const distB = new Array<number>(nodeCount).fill(INF);
  const prevF = new Array<number>(nodeCount).fill(-1);
  const prevB = new Array<number>(nodeCount).fill(-1);
  const doneF = new Uint8Array(nodeCount);
  const doneB = new Uint8Array(nodeCount);
  const heapF = new MinHeap();
  const heapB = new MinHeap();
  distF[source] = 0;
  distB[target] = 0;
  heapF.push(0, source);
  heapB.push(0, target);

  let best = INF;
  let meeting = -1;

  /** Drops stale heap entries so the top key is the true frontier minimum. */
  const clean = (heap: MinHeap, dist: number[], done: Uint8Array) => {
    while (
      heap.size > 0 &&
      (done[heap.peekNode()] || heap.peekKey() > dist[heap.peekNode()])
    )
      heap.pop();
  };

  const settleForward = () => {
    heapF.pop();
    const u = heapF.lastNode;
    doneF[u] = 1;
    if (distF[u] + distB[u] < best) {
      best = distF[u] + distB[u];
      meeting = u;
    }
    for (const edge of adjacency[u]) {
      const alt = distF[u] + edge.weight;
      if (alt < distF[edge.to]) {
        distF[edge.to] = alt;
        prevF[edge.to] = u;
        heapF.push(alt, edge.to);
      }
      if (distF[edge.to] + distB[edge.to] < best) {
        best = distF[edge.to] + distB[edge.to];
        meeting = edge.to;
      }
    }
  };

  const settleBackward = () => {
    heapB.pop();
    const u = heapB.lastNode;
    doneB[u] = 1;
    if (distF[u] + distB[u] < best) {
      best = distF[u] + distB[u];
      meeting = u;
    }
    for (const { from: v, weight } of reverseAdj[u]) {
      const alt = distB[u] + weight;
      if (alt < distB[v]) {
        distB[v] = alt;
        prevB[v] = u;
        heapB.push(alt, v);
      }
      if (distF[v] + distB[v] < best) {
        best = distF[v] + distB[v];
        meeting = v;
      }
    }
  };

  while (true) {
    clean(heapF, distF, doneF);
    clean(heapB, distB, doneB);
    const minF = heapF.peekKey();
    const minB = heapB.peekKey();
    if (minF === INF && minB === INF) break;
    if (best <= minF + minB) break;
    if (minF <= minB) settleForward();
    else settleBackward();
  }

  if (!Number.isFinite(best) || meeting < 0) {
    return { distance: INF, path: [] };
  }

  const forwardPath: NodeId[] = [];
  let current = meeting;
  while (current !== -1) {
    forwardPath.unshift(current);
    if (current === source) break;
    current = prevF[current];
  }
  const backwardPath: NodeId[] = [];
  current = prevB[meeting];
  while (current !== -1 && current !== target) {
    backwardPath.push(current);
    current = prevB[current];
  }
  if (current === target) backwardPath.push(target);
  // Remove duplicate meeting node.
  const path = forwardPath.concat(backwardPath);
  return { distance: best, path };
}
