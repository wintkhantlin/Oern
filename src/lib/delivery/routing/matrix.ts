import type { DispatchParams, Matrix, Point } from "../dispatch/types.ts";
import type { ContractionHierarchy } from "./contraction-hierarchies.ts";
import { dijkstra, shortestPath } from "./dijkstra.ts";
import type { Graph } from "./graph.ts";
import { haversineKm } from "./graph.ts";
import type { LandmarkIndex } from "./landmarks.ts";
import { snapToNode } from "./snap.ts";

export function buildStraightLineFallback(
  points: Point[],
  params: Pick<DispatchParams, "speedKmh" | "roadFactor">,
): Matrix {
  const n = points.length;
  const time = new Float64Array(n * n);
  const km = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const road =
        haversineKm(
          { latitude: points[i].lat, longitude: points[i].lng },
          { latitude: points[j].lat, longitude: points[j].lng },
        ) * params.roadFactor;
      km[i * n + j] = road;
      time[i * n + j] = (road / params.speedKmh) * 60;
    }
  }
  return {
    n,
    time,
    km,
    floodFrac: null,
    blocked: null,
    source: "straight_line",
  };
}

type MatrixBuildOptions = {
  maxSnapKm?: number;
  /** Accepted for compatibility; matrices now use one Dijkstra per source. */
  ch?: ContractionHierarchy;
  contractionHierarchy?: ContractionHierarchy;
};

/** Points farther than this from any graph node are priced straight-line. */
const DEFAULT_MAX_SNAP_KM = 1.5;
const DEFAULT_ROAD_FACTOR = 1.18;

function resolveOptions(arg: unknown): MatrixBuildOptions {
  if (typeof arg === "number") return { maxSnapKm: arg };
  if (arg && typeof arg === "object") return arg as MatrixBuildOptions;
  return {};
}

/**
 * All-pairs shortest paths over a road graph. Points are snapped to the nearest
 * graph node (within maxSnapKm); distances are converted to minutes using the
 * supplied speed. The straight-line leg between a point and its node is added
 * (x roadFactor), and unsnapped or unreachable pairs fall back to straight line.
 * Edge weights are metres.
 */
export function buildShortestPathMatrix(
  graph: Graph,
  points: Point[],
  params: Parameters<typeof buildShortestPathMatrixWithStats>[2],
  maxSnapKmOrOptions?: number | MatrixBuildOptions,
  _contractionHierarchy?: ContractionHierarchy,
): Matrix {
  return buildShortestPathMatrixWithStats(
    graph,
    points,
    params,
    maxSnapKmOrOptions,
  ).matrix;
}

/** Same as buildShortestPathMatrix, also counting pairs priced from the graph. */
export function buildShortestPathMatrixWithStats(
  graph: Graph,
  points: Point[],
  params: Pick<
    DispatchParams,
    "speedKmh" | "truckTimeFactor" | "trafficMultiplier"
  > & { maxSnapKm?: number; roadFactor?: number },
  maxSnapKmOrOptions?: number | MatrixBuildOptions,
): { matrix: Matrix; realPairs: number; totalPairs: number } {
  const n = points.length;
  let realPairs = 0;
  const opts = resolveOptions(maxSnapKmOrOptions);
  const maxSnapKm = opts.maxSnapKm ?? params.maxSnapKm ?? DEFAULT_MAX_SNAP_KM;
  const roadFactor = params.roadFactor ?? DEFAULT_ROAD_FACTOR;

  const geo = (point: Point) => ({ latitude: point.lat, longitude: point.lng });
  const snapped: (number | null)[] = points.map((point) =>
    snapToNode(graph, geo(point), maxSnapKm),
  );
  const offsetKm = points.map((point, i) => {
    const node = snapped[i];
    if (node === null || !graph.coordinates) return 0;
    return haversineKm(geo(point), graph.coordinates[node]);
  });

  const time = new Float64Array(n * n);
  const km = new Float64Array(n * n);
  const scale = params.truckTimeFactor * params.trafficMultiplier;
  const set = (i: number, j: number, road: number) => {
    km[i * n + j] = road;
    time[i * n + j] = (road / params.speedKmh) * 60 * scale;
  };

  // One Dijkstra per distinct snapped source node, stopping once every
  // snapped node is settled.
  const targets = new Set<number>();
  for (const node of snapped) if (node !== null) targets.add(node);
  const distCache = new Map<number, number[]>();
  const distancesFrom = (source: number) => {
    let dist = distCache.get(source);
    if (!dist) {
      dist = dijkstra(graph, source, undefined, targets).distances;
      distCache.set(source, dist);
    }
    return dist;
  };

  for (let i = 0; i < n; i++) {
    const from = snapped[i];
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const to = snapped[j];
      const straight = haversineKm(geo(points[i]), geo(points[j])) * roadFactor;
      if (from === null || to === null) {
        set(i, j, straight); // Off-network point.
        continue;
      }
      if (points[i].lat === points[j].lat && points[i].lng === points[j].lng) {
        // A shared physical location has no access journey between the two
        // stops, even when both are snapped away from the road node.
        realPairs++;
        set(i, j, 0);
        continue;
      }
      const access = (offsetKm[i] + offsetKm[j]) * roadFactor;
      if (from === to) {
        realPairs++;
        // Same node: never closer than the straight-line distance.
        set(i, j, Math.max(access, straight));
        continue;
      }
      const dist = distancesFrom(from)[to];
      // Disconnected pair: straight line.
      if (Number.isFinite(dist)) realPairs++;
      set(i, j, Number.isFinite(dist) ? dist / 1000 + access : straight);
    }
  }
  const totalPairs = n * (n - 1);
  return {
    matrix: {
      n,
      time,
      km,
      floodFrac: null,
      blocked: null,
      source:
        realPairs === 0
          ? "straight_line"
          : realPairs === totalPairs
            ? "road_matrix"
            : "road_calibrated",
    },
    realPairs,
    totalPairs,
  };
}

export function shortestPathBetween(
  graph: Graph,
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
  maxSnapKm = Number.POSITIVE_INFINITY,
  options?: { landmarks?: LandmarkIndex },
) {
  // Prepared tables describe an immutable metric. Pass index.graph explicitly;
  // accepting any other graph could combine changed weights with stale bounds.
  if (options?.landmarks && options.landmarks.graph !== graph)
    throw new Error(
      "landmark routing requires the prepared index.graph snapshot",
    );
  const source = snapToNode(graph, from, maxSnapKm);
  const target = snapToNode(graph, to, maxSnapKm);
  if (source === null || target === null)
    return { distance: Infinity, path: [] };
  return options?.landmarks
    ? options.landmarks.query(source, target)
    : shortestPath(graph, source, target);
}
