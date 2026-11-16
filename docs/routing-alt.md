# Directed landmark routing

`buildLandmarkIndex` prepares exact point-to-point routing with ALT (A*,
landmarks and triangle inequalities). Unlike a geographic heuristic, its bounds
use the graph's actual weights and remain valid for one-way roads. It stores
both landmark-to-node and node-to-landmark distances, and ignores unavailable
bounds in disconnected components. Queries reopen improved nodes when bounds
are inconsistent.

```ts
import { buildLandmarkIndex } from "../src/lib/delivery/routing/landmarks.ts";
import { shortestPathBetween } from "../src/lib/delivery/routing/matrix.ts";

const index = buildLandmarkIndex(roadGraph, { landmarkCount: 4 });
const direct = index.query(sourceNode, targetNode);
// { distance, path, settledNodes }, distance uses the graph's weight units.

const snapped = shortestPathBetween(
  index.graph,
  { latitude: 16.8, longitude: 96.1 },
  { latitude: 16.82, longitude: 96.13 },
  1.5,
  { landmarks: index },
);
```

The prepared index owns a frozen graph snapshot. Pass `index.graph` to
`shortestPathBetween`; passing the source graph throws because its metric could
have changed since preprocessing. Updates to road closures, topology or traffic
weights require a new index. Prepared queries continue describing their original
snapshot. Apply any validated traffic weights before preparing the index.

The default uses up to four deterministic farthest-first landmarks; the maximum
is 32. Supply `{ landmarks: [nodeA, nodeB] }` for explicit landmarks, or
`{ landmarks: [] }` for a zero-heuristic Dijkstra baseline. Preprocessing performs
two Dijkstra runs per landmark, takes O(k(V + E) log V) time, and retains
O(kV + V + E) memory including the snapshot. Each node's heuristic costs O(k).
Actual speedups depend on topology and landmark placement; no production
latency guarantee is implied. `settledNodes` measures expanded queue entries,
including a reached target and any nodes reopened after an improvement.

The existing dispatch all-pairs matrix retains its target-limited Dijkstra
strategy. ALT serves repeated point-to-point queries and does not fabricate
time-dependent traffic observations, turn restrictions or transportation data.

Reference: Andrew V. Goldberg and Chris Harrelson, [Computing the Shortest Path:
A* Search Meets Graph Theory](https://www.microsoft.com/en-us/research/publication/computing-the-shortest-path-a-search-meets-graph-theory/),
SODA 2005.
