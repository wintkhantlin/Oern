import { distanceToSegmentKm } from "../energy-routing.ts";
import {
  buildSignalIndex,
  type SignalNode,
  signalDelayMin,
  signalsAlongPath,
} from "../signal-index.ts";
import { createGraph, type Graph } from "./graph.ts";

export type TrafficSignalLike = {
  latitude: number;
  longitude: number;
  estimatedCycleSeconds: number;
};

/**
 * Total signal delay (minutes) for a single edge, checking every segment of its
 * geometry. Each signal is counted at most once per edge even when it sits near
 * a shared vertex.
 */
export function edgeSignalDelayMinutes(
  edge: {
    coordinates?: readonly { latitude: number; longitude: number }[];
    trafficSignalsApplied?: boolean;
  },
  signals: readonly TrafficSignalLike[],
  radiusKm = 0.045,
): number {
  if (!edge.coordinates || edge.coordinates.length < 2) return 0;
  if (edge.trafficSignalsApplied) return 0;
  const coords = edge.coordinates;
  const seen = new Set<number>();
  let delayMinutes = 0;
  for (let s = 0; s < coords.length - 1; s++) {
    const start = coords[s];
    const end = coords[s + 1];
    for (let i = 0; i < signals.length; i++) {
      if (seen.has(i)) continue;
      const distance = distanceToSegmentKm(signals[i], start, end);
      if (distance <= radiusKm) {
        seen.add(i);
        delayMinutes += signalDelayMin(signals[i].estimatedCycleSeconds);
      }
    }
  }
  return delayMinutes;
}

/**
 * Return a copy of `graph` with red-light wait time folded into edge weights.
 * Does not mutate the input graph and is idempotent: edges already carrying
 * traffic-signal delay are not adjusted again.
 *
 * Each signal is charged once, to the physical road segment it is closest to
 * (both directions of that segment carry the delay), so a light beside a
 * shared node is not added to every adjoining edge. Weights are metres that
 * the matrix later turns into minutes at `speedKmh` times `timeScale`
 * (truckTimeFactor x trafficMultiplier); pass that same `timeScale` so the
 * delay is not inflated by it a second time.
 */
export function applyTrafficSignals(
  graph: Graph,
  signals: readonly TrafficSignalLike[],
  speedKmh: number,
  radiusKm = 0.045,
  timeScale = 1,
): Graph {
  const metresPerMinute = ((speedKmh / 60) * 1000) / (timeScale || 1);
  const result = createGraph(
    graph.nodeCount,
    graph.coordinates ? [...graph.coordinates] : undefined,
  );

  // Physical segments: twin directed edges share one geometry array.
  type Entry = { u: number; i: number };
  const groups = new Map<object, Entry[]>();
  for (let u = 0; u < graph.nodeCount; u++) {
    graph.adjacency[u].forEach((edge, i) => {
      if (edge.trafficSignalsApplied) return;
      if (!edge.coordinates || edge.coordinates.length < 2) return;
      const group = groups.get(edge.coordinates);
      if (group) group.push({ u, i });
      else groups.set(edge.coordinates, [{ u, i }]);
    });
  }
  const nodes: SignalNode[] = signals.map((signal, i) => ({
    id: String(i),
    name: String(i),
    latitude: signal.latitude,
    longitude: signal.longitude,
    estimatedCycleSeconds: signal.estimatedCycleSeconds,
  }));
  const index = buildSignalIndex(nodes);
  const owner = new Map<number, { group: object; km: number }>();
  for (const [coords] of groups) {
    const path = (coords as readonly { latitude: number; longitude: number }[]).map(
      (c) => [c.longitude, c.latitude] as const,
    );
    for (const hit of signalsAlongPath(index, path, radiusKm)) {
      const id = Number(hit.node.id);
      const known = owner.get(id);
      if (!known || hit.distanceKm < known.km)
        owner.set(id, { group: coords, km: hit.distanceKm });
    }
  }
  const delayOf = new Map<object, number>();
  for (const [id, { group }] of owner)
    delayOf.set(
      group,
      (delayOf.get(group) ?? 0) + signalDelayMin(signals[id].estimatedCycleSeconds),
    );

  for (let u = 0; u < graph.nodeCount; u++) {
    result.adjacency[u] = graph.adjacency[u].map((edge) => {
      if (edge.trafficSignalsApplied) return { ...edge };
      const delayMinutes = edge.coordinates
        ? (delayOf.get(edge.coordinates) ?? 0)
        : 0;
      // Mark applied even when no delay, so repeated calls stay idempotent.
      return {
        ...edge,
        weight: edge.weight + delayMinutes * metresPerMinute,
        trafficSignalsApplied: true,
      };
    });
  }
  return result;
}
