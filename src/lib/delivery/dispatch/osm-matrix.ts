import { readFile } from "node:fs/promises";
import path from "node:path";
import { MinHeap } from "../routing/heap.ts";
import { buildStraightLineMatrix, haversineKm } from "./matrix.ts";
import type { DispatchParams, Matrix, Point } from "./types.ts";

/**
 * Road matrix from the OpenStreetMap Yangon extract (scripts/build-osm-graph.py
 * writes data/generated/yangon-road-graph.json). Free: no token, no network.
 * Distances follow real roads and one-way rules; time uses the planner speed.
 */
export type OsmGraph = {
  n: number;
  lat: Float64Array;
  lng: Float64Array;
  /** CSR adjacency: edges of node u are start[u] .. start[u+1]. */
  start: Uint32Array;
  to: Uint32Array;
  metres: Float32Array;
};

type RawGraph = {
  nodes: [number, number][];
  edges: [number, number, number, number][];
};

export function buildOsmGraph(raw: RawGraph): OsmGraph {
  const n = raw.nodes.length;
  const lat = new Float64Array(n);
  const lng = new Float64Array(n);
  raw.nodes.forEach(([a, b], i) => {
    lat[i] = a;
    lng[i] = b;
  });
  const degree = new Uint32Array(n + 1);
  for (const [a, b, , oneway] of raw.edges) {
    degree[a]++;
    if (!oneway) degree[b]++;
  }
  const start = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) start[i + 1] = start[i] + degree[i];
  const fill = start.slice(0, n);
  const to = new Uint32Array(start[n]);
  const metres = new Float32Array(start[n]);
  const push = (a: number, b: number, m: number) => {
    to[fill[a]] = b;
    metres[fill[a]++] = m;
  };
  for (const [a, b, m, oneway] of raw.edges) {
    push(a, b, m);
    if (!oneway) push(b, a, m);
  }
  return { n, lat, lng, start, to, metres };
}

let cached: Promise<OsmGraph | null> | null = null;
export function loadOsmGraph(): Promise<OsmGraph | null> {
  cached ??= readFile(
    path.join(process.cwd(), "data", "generated", "yangon-road-graph.json"),
    "utf8",
  )
    .then((text) => buildOsmGraph(JSON.parse(text) as RawGraph))
    .catch(() => null);
  return cached;
}

/** Uniform lat/lng grid over the graph nodes, so snapping is not an O(N) scan. */
const GRID_DEG = 0.01;
type Grid = { cells: Map<number, number[]> };
const gridCache = new WeakMap<OsmGraph, Grid>();
const cellKey = (cy: number, cx: number) => cy * 100_000 + cx;

function gridOf(g: OsmGraph): Grid {
  let grid = gridCache.get(g);
  if (!grid) {
    const cells = new Map<number, number[]>();
    for (let i = 0; i < g.n; i++) {
      const key = cellKey(
        Math.floor((g.lat[i] + 90) / GRID_DEG),
        Math.floor((g.lng[i] + 180) / GRID_DEG),
      );
      const bucket = cells.get(key);
      if (bucket) bucket.push(i);
      else cells.set(key, [i]);
    }
    grid = { cells };
    gridCache.set(g, grid);
  }
  return grid;
}

/** Nearest graph node within maxKm, with the straight-line offset to it. */
export function snapNodeWithOffset(
  g: OsmGraph,
  p: Point,
  maxKm: number,
): { node: number; offsetKm: number } | null {
  if (g.n === 0) return null;
  const { cells } = gridOf(g);
  const cos = Math.max(0.05, Math.cos((p.lat * Math.PI) / 180));
  const minCellKm = GRID_DEG * 111.2 * cos;
  const maxRing = Math.min(400, Math.ceil(maxKm / minCellKm) + 1);
  const cy = Math.floor((p.lat + 90) / GRID_DEG);
  const cx = Math.floor((p.lng + 180) / GRID_DEG);
  let best = -1;
  let bestKm = Infinity;
  const visit = (y: number, x: number) => {
    const bucket = cells.get(cellKey(y, x));
    if (!bucket) return;
    for (const i of bucket) {
      const dy = (g.lat[i] - p.lat) * 111.2;
      const dx = (g.lng[i] - p.lng) * 111.2 * cos;
      const approx = Math.hypot(dx, dy);
      if (approx < bestKm) {
        bestKm = approx;
        best = i;
      }
    }
  };
  for (let ring = 0; ring <= maxRing; ring++) {
    if (ring === 0) visit(cy, cx);
    else {
      for (let d = -ring; d <= ring; d++) {
        visit(cy - ring, cx + d);
        visit(cy + ring, cx + d);
      }
      for (let d = -ring + 1; d <= ring - 1; d++) {
        visit(cy + d, cx - ring);
        visit(cy + d, cx + ring);
      }
    }
    // Every unseen node is at least `ring` cells away.
    if (best >= 0 && bestKm <= ring * minCellKm) break;
  }
  if (best < 0) return null;
  const exact = haversineKm(p, { lat: g.lat[best], lng: g.lng[best] } as Point);
  return exact <= maxKm ? { node: best, offsetKm: exact } : null;
}

export function snapNode(g: OsmGraph, p: Point, maxKm: number): number | null {
  return snapNodeWithOffset(g, p, maxKm)?.node ?? null;
}

/** Binary-heap Dijkstra from one source; stops once every target is settled. */
export function distancesFrom(
  g: OsmGraph,
  source: number,
  targets: Set<number>,
): Float64Array {
  const dist = new Float64Array(g.n).fill(Infinity);
  const heap = new MinHeap();
  const remaining = new Set(targets);
  dist[source] = 0;
  heap.push(0, source);
  while (heap.pop() && remaining.size) {
    const node = heap.lastNode;
    const key = heap.lastKey;
    if (key > dist[node]) continue;
    remaining.delete(node);
    for (let e = g.start[node]; e < g.start[node + 1]; e++) {
      const next = g.to[e];
      const alt = key + g.metres[e];
      if (alt < dist[next]) {
        dist[next] = alt;
        heap.push(alt, next);
      }
    }
  }
  return dist;
}

const MAX_SNAP_KM = 1.5;

export type OsmMatrixResult = {
  matrix: Matrix;
  /** Points snapped to the graph, out of `total` points. */
  snapped: number;
  total: number;
  /** Ordered pairs priced from roads, out of n(n-1). */
  realPairs: number;
  totalPairs: number;
  coverage: number;
};

export function buildOsmMatrix(
  g: OsmGraph,
  points: Point[],
  params: Pick<
    DispatchParams,
    "speedKmh" | "roadFactor" | "truckTimeFactor" | "trafficMultiplier"
  >,
): OsmMatrixResult {
  const n = points.length;
  const fallback = buildStraightLineMatrix(points, params);
  const snaps = points.map((p) => snapNodeWithOffset(g, p, MAX_SNAP_KM));
  const time = new Float64Array(fallback.time);
  const km = new Float64Array(fallback.km);
  const scale = params.truckTimeFactor * params.trafficMultiplier;
  const targets = new Set(
    snaps.filter((x) => x !== null).map((x) => (x as { node: number }).node),
  );
  // One Dijkstra per distinct snapped node, shared by every point on it.
  const bySource = new Map<number, number[]>();
  snaps.forEach((snap, i) => {
    if (!snap) return;
    const list = bySource.get(snap.node);
    if (list) list.push(i);
    else bySource.set(snap.node, [i]);
  });
  let realPairs = 0;
  for (const [node, rows] of bySource) {
    const dist = distancesFrom(g, node, targets);
    for (const i of rows) {
      const from = snaps[i] as { node: number; offsetKm: number };
      for (let j = 0; j < n; j++) {
        const to = snaps[j];
        if (i === j || !to) continue;
        if (
          points[i].lat === points[j].lat &&
          points[i].lng === points[j].lng
        ) {
          km[i * n + j] = 0;
          time[i * n + j] = 0;
          realPairs++;
          continue;
        }
        const sameNode = to.node === node;
        if (!sameNode && !Number.isFinite(dist[to.node])) continue;
        // Legs to and from the road cost distance too; two points on one
        // node still cannot be closer than their straight-line distance.
        const access = (from.offsetKm + to.offsetKm) * params.roadFactor;
        const road = sameNode
          ? Math.max(access, fallback.km[i * n + j])
          : dist[to.node] / 1000 + access;
        km[i * n + j] = road;
        time[i * n + j] = (road / params.speedKmh) * 60 * scale;
        realPairs++;
      }
    }
  }
  const totalPairs = n * (n - 1);
  const coverage = totalPairs > 0 ? realPairs / totalPairs : 0;
  return {
    matrix: {
      ...fallback,
      time,
      km,
      source:
        realPairs === 0
          ? "straight_line"
          : realPairs === totalPairs
            ? "road_matrix"
            : "road_calibrated",
    },
    snapped: snaps.filter((x) => x !== null).length,
    total: n,
    realPairs,
    totalPairs,
    coverage,
  };
}
