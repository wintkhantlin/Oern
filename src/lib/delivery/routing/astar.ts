import type { Graph, NodeId, ShortestPathResult } from "./graph.ts";
import { MinHeap } from "./heap.ts";

const INF = Number.POSITIVE_INFINITY;

export type Heuristic = (node: NodeId) => number;

export function aStar(
  graph: Graph,
  source: NodeId,
  target: NodeId,
  heuristic: Heuristic,
): ShortestPathResult {
  const { nodeCount, adjacency } = graph;
  const gScore = new Array<number>(nodeCount).fill(INF);
  const fScore = new Array<number>(nodeCount).fill(INF);
  const previous = new Array<number>(nodeCount).fill(-1);
  const done = new Uint8Array(nodeCount);
  const open = new MinHeap();
  gScore[source] = 0;
  fScore[source] = heuristic(source);
  open.push(fScore[source], source);

  while (open.pop()) {
    const current = open.lastNode;
    if (done[current] || open.lastKey > fScore[current]) continue;
    if (current === target) {
      const path: NodeId[] = [];
      let node = target;
      while (node !== -1) {
        path.unshift(node);
        if (node === source) break;
        node = previous[node];
      }
      return { distance: gScore[target], path };
    }
    done[current] = 1;
    for (const edge of adjacency[current]) {
      const tentative = gScore[current] + edge.weight;
      if (tentative < gScore[edge.to]) {
        previous[edge.to] = current;
        gScore[edge.to] = tentative;
        fScore[edge.to] = tentative + heuristic(edge.to);
        // Re-open on improvement (also covers inconsistent heuristics).
        done[edge.to] = 0;
        open.push(fScore[edge.to], edge.to);
      }
    }
  }
  return { distance: INF, path: [] };
}
