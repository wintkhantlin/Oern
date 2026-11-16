import {
  YUTRA_CONGESTION,
  type YutraCongestion,
} from "../data/yutra-network.ts";
import {
  YUTRA_SIGNAL_DELAYS,
  type YutraSignalDelay,
} from "../data/yutra-signal-delays.ts";
import {
  countInterceptionPointsBetween,
  countTrafficSignalsBetween,
  distanceToSegmentKm,
} from "../energy-routing.ts";
import { priceRoadReport, signalCostMin } from "../routing-cost.ts";
import type { Matrix, Point } from "./types.ts";

export type TrafficReport = {
  lat?: number;
  lng?: number;
  latitude?: number;
  longitude?: number;
  category?: string;
  severity?: string;
  /** The engine's reading of the note; replaces the raw category/severity table. */
  decision?: {
    action: "avoid" | "delay" | "monitor" | "ignore";
    severity: string;
    delayMinutes: number;
    radiusMeters: number;
  };
};

export type TrafficOrder = {
  id?: string;
  delivery_latitude?: number | null;
  delivery_longitude?: number | null;
  traffic_delay_minutes?: number | null;
};

export type TrafficSummary = {
  signalsCovered: number;
  interceptionsCovered: number;
  reportsCovered: number;
  ordersWithTrafficDelay: number;
  addedDelayMin: number;
  arcsWithDelay: number;
  blockedArcs: number;
  /** Surveyed signals whose measured delay replaced the modelled one. */
  measuredSignalsUsed?: number;
  /** Surveyed junctions whose peak/off-peak queueing delay was added. */
  congestedJunctionsUsed?: number;
};

/** Extra queueing minutes per junction pass, by surveyed congestion level. */
export const CONGESTION_DELAY_MIN = { low: 0, medium: 0.6, high: 1.5 } as const;

/** Survey windows, Yangon local time (UTC+6:30). */
export function yutraPeriodAt(nowMs: number): "peak" | "offpeak" | null {
  const d = new Date(nowMs + 6.5 * 3_600_000);
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (minutes >= 7 * 60 + 30 && minutes < 9 * 60 + 30) return "peak";
  if (minutes >= 14 * 60 && minutes < 16 * 60) return "offpeak";
  return null;
}

export type ApplyTrafficOptions = {
  reports?: TrafficReport[];
  orders?: TrafficOrder[];
  corridorThresholdKm?: number;
  nowMs?: number;
  /**
   * Measured signal delays (YUTRA survey). Pass [] to switch off. Only
   * "verified" observations are used by default.
   */
  measuredSignals?: readonly YutraSignalDelay[];
  /** YUTRA junction congestion, used when `nowMs` is in a surveyed window. Pass [] to switch off. */
  congestion?: readonly YutraCongestion[];
};

/** Same junction if a hand-mapped or arterial signal lies this close. */
const SAME_JUNCTION_LAT = 0.0011;
const SAME_JUNCTION_LNG = 0.0012;
const sameJunction = (
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) =>
  Math.abs(a.latitude - b.latitude) < SAME_JUNCTION_LAT &&
  Math.abs(a.longitude - b.longitude) < SAME_JUNCTION_LNG;

const TRAFFIC_CATEGORIES = new Set([
  "congestion",
  "roadwork",
  "hazard",
  "closure",
]);

function reportPoint(
  report: TrafficReport,
): { latitude: number; longitude: number } | null {
  const lat = report.latitude ?? report.lat;
  const lng = report.longitude ?? report.lng;
  return lat != null && lng != null ? { latitude: lat, longitude: lng } : null;
}

function isTrafficReport(report: TrafficReport): boolean {
  if (!report.category) return true;
  return TRAFFIC_CATEGORIES.has(report.category);
}

/**
 * Layers Yangon's signalized junctions, user-mapped interception points,
 * live traffic road reports (congestion, roadwork, hazard, closure),
 * and order-level traffic delays onto the dispatch travel-time matrix.
 *
 * For each directed arc (i -> j):
 * - Signals add deceleration and red-light cycle delay (~0.95 min per signal)
 * - User interception midpoints add deceleration and traffic friction (~0.35 min per midpoint)
 * - Live traffic road reports within the corridor add congestion delay according to severity
 * - Blocked/closure road reports mark the arc as impassable (matrix.blocked)
 * - Arcs leading to delivery destinations with order traffic delays incur those delays
 *
 * This guides Clarke-Wright savings heuristics and 2-Opt/Or-Opt local search
 * to route deliveries around congested bottlenecks and avoid high-friction corridors.
 */
export function applyTraffic(
  matrix: Matrix,
  points: Point[],
  optionsOrThreshold?: number | ApplyTrafficOptions,
): { matrix: Matrix; summary: TrafficSummary } {
  const options: ApplyTrafficOptions =
    typeof optionsOrThreshold === "number"
      ? { corridorThresholdKm: optionsOrThreshold }
      : (optionsOrThreshold ?? {});

  const corridorThresholdKm = options.corridorThresholdKm ?? 0.45;
  const nowMs = options.nowMs ?? Date.now();
  const reports = options.reports ?? [];
  const orders = options.orders ?? [];
  const measured = (
    options.measuredSignals ??
    YUTRA_SIGNAL_DELAYS.filter((m) => m.confidence === "verified")
  ).filter((m) => m.dataType === "observed");
  const measuredUsed = new Set<string>();
  const period = yutraPeriodAt(nowMs);
  const congestion = period
    ? (options.congestion ?? YUTRA_CONGESTION).filter(
        (c) => c.period === period && CONGESTION_DELAY_MIN[c.level] > 0,
      )
    : [];
  const congestionUsed = new Set<string>();

  const n = matrix.n;
  const time = new Float64Array(matrix.time);
  let blocked = matrix.blocked ? new Uint8Array(matrix.blocked) : null;

  let signalsCovered = 0;
  let interceptionsCovered = 0;
  const matchedReports = new Set<TrafficReport>();
  let addedDelayMin = 0;
  let arcsWithDelay = 0;
  let blockedArcs = 0;

  // Build a delivery point to order traffic delay map (matching delivery latitude and longitude)
  const deliveryNodeDelays = new Map<number, number>();
  const ordersApplied = new Set<string>();

  for (const order of orders) {
    const delay = order.traffic_delay_minutes ?? 0;
    if (delay <= 0) continue;
    if (order.delivery_latitude == null || order.delivery_longitude == null)
      continue;

    // Find corresponding node index in points
    for (let idx = 0; idx < points.length; idx++) {
      if (
        Math.abs(points[idx].lat - order.delivery_latitude) < 1e-5 &&
        Math.abs(points[idx].lng - order.delivery_longitude) < 1e-5
      ) {
        const existing = deliveryNodeDelays.get(idx) ?? 0;
        deliveryNodeDelays.set(idx, Math.max(existing, delay));
        if (order.id) ordersApplied.add(order.id);
        else ordersApplied.add(`idx-${idx}`);
      }
    }
  }

  // Filter traffic reports once
  const validTrafficReports = reports
    .filter(isTrafficReport)
    .map((r) => ({ report: r, point: reportPoint(r) }))
    .filter(
      (
        entry,
      ): entry is {
        report: TrafficReport;
        point: { latitude: number; longitude: number };
      } => entry.point != null,
    );

  // Reports do not vary by arc, so price each once.
  const prices = new Map(
    validTrafficReports.map(({ report }) => [
      report,
      priceRoadReport(
        {
          ...report,
          category: report.category ?? "congestion",
          severity: report.severity ?? "medium",
        },
        nowMs,
      ),
    ]),
  );

  for (let i = 0; i < n; i++) {
    const from = { latitude: points[i].lat, longitude: points[i].lng };
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const arc = i * n + j;
      const to = { latitude: points[j].lat, longitude: points[j].lng };
      // Different stops can share coordinates. There is no road corridor to
      // cross between them, so corridor signals, reports and closures do not
      // apply. Keep order-level delivery delays below: those describe the
      // destination/order rather than travel along this zero-length leg.
      const sameLocation =
        from.latitude === to.latitude && from.longitude === to.longitude;

      let arcDelay = 0;
      if (!sameLocation) {
        const intResult = countInterceptionPointsBetween(
          from,
          to,
          corridorThresholdKm,
        );
        const userPoints = intResult.points;
        const ints = intResult.count;
        // An arterial signal at the same junction as a hand-mapped light is one
        // stop, not two
        const signals = countTrafficSignalsBetween(
          from,
          to,
          corridorThresholdKm,
        ).signals.filter(
          (signal) =>
            !userPoints.some(
              (pt) =>
                pt.type === "traffic_light" &&
                Math.abs(pt.latitude - signal.latitude) < 0.0011 &&
                Math.abs(pt.longitude - signal.longitude) < 0.0012,
            ),
        );
        const sigs = signals.length;

        // Base signal and user traffic point delay:
        // Traffic lights apply cycle-calibrated red-light and deceleration delay;
        // Side-street bypass waypoints provide bottleneck relief; midpoints apply friction
        let userPointsDelay = 0;
        for (const pt of userPoints) {
          if (pt.type === "bypass_waypoint") {
            // Bypass waypoints represent side-street bypass routes; zero bottleneck delay
            continue;
          }
          if (pt.type === "traffic_light") {
            // If a known side-street bypass exists for this traffic light along the corridor,
            // traffic diversion significantly reduces junction delay
            const hasBypass = userPoints.some(
              (b) =>
                b.type === "bypass_waypoint" && b.bypassesPointId === pt.id,
            );
            if (hasBypass) {
              userPointsDelay += 0.2; // Minor side-turn friction instead of full red-light queue
            } else {
              userPointsDelay += signalCostMin(pt.estimatedCycleSeconds);
            }
          } else {
            userPointsDelay += 0.35;
          }
        }

        // Arterial signals are priced by cycle, exactly as navigation prices them
        arcDelay = userPointsDelay;
        for (const signal of signals)
          arcDelay += signalCostMin(signal.estimatedCycleSeconds);
        // A surveyed signal on this leg: its measured delay replaces the modelled
        // one at the same junction (so it is never counted twice), or is added if
        // the model did not know the junction. Bypassed lights keep their model.
        for (const m of measured) {
          if (distanceToSegmentKm(m, from, to) > corridorThresholdKm) continue;
          const mapped = userPoints.find(
            (pt) => pt.type === "traffic_light" && sameJunction(pt, m),
          );
          if (
            mapped &&
            userPoints.some(
              (b) =>
                b.type === "bypass_waypoint" && b.bypassesPointId === mapped.id,
            )
          )
            continue;
          const arterial = signals.find((signal) => sameJunction(signal, m));
          if (mapped) arcDelay -= signalCostMin(mapped.estimatedCycleSeconds);
          else if (arterial)
            arcDelay -= signalCostMin(arterial.estimatedCycleSeconds);
          arcDelay += m.meanDelaySeconds / 60;
          measuredUsed.add(m.id);
        }
        arcDelay = Math.max(0, arcDelay);
        for (const c of congestion) {
          if (distanceToSegmentKm(c, from, to) > corridorThresholdKm) continue;
          arcDelay += CONGESTION_DELAY_MIN[c.level];
          congestionUsed.add(c.name);
        }
        signalsCovered += sigs;
        interceptionsCovered += ints;

        // Check live traffic road reports along the corridor
        for (const { report, point } of validTrafficReports) {
          const price = prices.get(report);
          if (!price) continue;
          // No road geometry here, only the straight line: a wider corridor
          // stands in for the true path navigation measures against.
          const reach = report.decision
            ? Math.max(0.15, price.reachKm)
            : corridorThresholdKm;
          if (distanceToSegmentKm(point, from, to) > reach) continue;
          arcDelay += price.delayMin;
          matchedReports.add(report);
          if (price.blocked) {
            if (!blocked) blocked = new Uint8Array(n * n);
            blocked[arc] = 1;
            blockedArcs++;
          }
        }
      }

      // Check order delivery traffic delay if node j is a delivery destination
      const orderDelay = deliveryNodeDelays.get(j);
      if (orderDelay != null && orderDelay > 0) {
        arcDelay += orderDelay;
      }

      if (arcDelay > 0) {
        time[arc] += arcDelay;
        addedDelayMin += arcDelay;
        arcsWithDelay++;
      }
    }
  }

  return {
    matrix: {
      ...matrix,
      time,
      blocked: blocked ?? matrix.blocked,
    },
    summary: {
      signalsCovered,
      interceptionsCovered,
      reportsCovered: matchedReports.size,
      ordersWithTrafficDelay: ordersApplied.size,
      addedDelayMin: Math.round(addedDelayMin * 10) / 10,
      arcsWithDelay,
      blockedArcs,
      measuredSignalsUsed: measuredUsed.size,
      congestedJunctionsUsed: congestionUsed.size,
    },
  };
}
