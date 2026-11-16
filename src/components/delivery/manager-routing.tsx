"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ConsoleShell } from "@/components/console/console-shell";
import { AuthDialog } from "@/components/delivery/auth-dialog";
import { PageHeader } from "@/components/delivery/common";
import {
  Container,
  StatusIndicator,
  type Tone,
} from "@/components/delivery/manager-home-view";
import {
  drawLines,
  fitToPoints,
  lngLat,
  mapPalette,
  useMapboxMap,
} from "@/components/delivery/mapbox-kit";
import { certify } from "@/lib/delivery/dispatch/bounds";
import type { DataSourceInfo } from "@/lib/delivery/dispatch/data-sources";
import { exactOptimum, MAX_EXACT_ORDERS } from "@/lib/delivery/dispatch/exact";
import {
  buildStraightLineMatrix,
  nodePoints,
} from "@/lib/delivery/dispatch/matrix";
import { solve } from "@/lib/delivery/dispatch/solve";
import { generateSynthetic } from "@/lib/delivery/dispatch/synthetic";
import { validateSolution } from "@/lib/delivery/dispatch/validate";
import { fetchRoadRoute, hasMapbox } from "@/lib/delivery/mapbox";
import { useWorkspace } from "@/lib/delivery/use-workspace";
import "./manager-home.css";
import "./manager-home-simple.css";
import "./manager-routing.css";

const ROUTE_COLORS = [
  "#0b6bcb",
  "#c2410c",
  "#15803d",
  "#7e22ce",
  "#be123c",
  "#0f766e",
];
const noClock = () => 0;

const STATE_LABEL: Record<DataSourceInfo["state"], string> = {
  active: "Connected",
  available: "Not connected",
  missing: "Unavailable",
};

/** Solve twice on purpose: identical hashes prove the plan is reproducible. */
function runLab(orders: number, trucks: number, seed: number) {
  const inst = generateSynthetic({
    seed,
    orders,
    trucks,
    depotShare: 0.3,
    // Serve every feasible parcel, as the live planner does.
    params: { unservedPenalty: 1e6 },
  });
  const matrix = buildStraightLineMatrix(nodePoints(inst), inst.params);
  const plan = solve(inst, matrix, { nowMs: noClock });
  const again = solve(inst, matrix, { nowMs: noClock });
  const violations = validateSolution(inst, matrix, plan);
  const exact =
    orders <= MAX_EXACT_ORDERS ? exactOptimum(inst, matrix).optimum : null;
  const certificate = certify(inst, matrix, plan, exact);
  return {
    inst,
    plan,
    violations,
    certificate,
    reproducible: plan.hash === again.hash,
  };
}

type Lab = ReturnType<typeof runLab>;
type LngLat = [number, number];

/** Stops of one truck as map points, depot first and last. */
function routePoints(inst: Lab["inst"], route: Lab["plan"]["routes"][number]) {
  const at = (r: number, kind: "P" | "D") => {
    const q = inst.requests[r];
    const p = kind === "P" && q.pickup ? q.pickup : q.delivery;
    return { latitude: p.lat, longitude: p.lng };
  };
  const depot = { latitude: inst.depot.lat, longitude: inst.depot.lng };
  return [depot, ...route.stops.map((s) => at(s.r, s.kind)), depot];
}

function RouteMap({
  inst,
  plan,
  selected,
  followRoads,
  fitSignal,
  onRoadState,
}: {
  inst: Lab["inst"];
  plan: Lab["plan"];
  selected: number | null;
  followRoads: boolean;
  fitSignal: number;
  onRoadState: (s: "off" | "loading" | "ready" | "fallback") => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapState = useMapboxMap(container, true);
  const [roads, setRoads] = useState<Record<string, LngLat[]>>({});
  const layers = useRef<string[]>([]);
  const markers = useRef<{ remove: () => void }[]>([]);
  const palette = mapPalette();

  // Snap each truck's stops to real roads, debounced while sliders move.
  useEffect(() => {
    if (!followRoads || !hasMapbox) {
      onRoadState("off");
      return;
    }
    const controller = new AbortController();
    onRoadState("loading");
    const timer = setTimeout(async () => {
      const next: Record<string, LngLat[]> = {};
      await Promise.all(
        plan.routes.map(async (route) => {
          if (!route.stops.length) return;
          try {
            const road = await fetchRoadRoute(
              routePoints(inst, route),
              undefined,
              controller.signal,
            );
            if (road) next[route.truckId] = road.coordinates;
          } catch {
            /* keep the straight-line fallback for this truck */
          }
        }),
      );
      if (controller.signal.aborted) return;
      setRoads(next);
      const wanted = plan.routes.filter((r) => r.stops.length).length;
      onRoadState(Object.keys(next).length >= wanted ? "ready" : "fallback");
    }, 500);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [followRoads, inst, plan, onRoadState]);

  useEffect(() => {
    if (!mapState) return;
    const { map, gl } = mapState;
    for (const id of layers.current) {
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
    }
    layers.current = [];
    for (const m of markers.current) m.remove();
    markers.current = [];

    plan.routes.forEach((route, k) => {
      if (!route.stops.length) return;
      const color = ROUTE_COLORS[k % ROUTE_COLORS.length];
      const dim = selected != null && selected !== k;
      const pts = routePoints(inst, route);
      const road = followRoads ? roads[route.truckId] : undefined;
      const coords: LngLat[] = road ?? pts.map(lngLat);
      const casing = `rl-casing-${k}`;
      const line = `rl-route-${k}`;
      drawLines(map, casing, [coords], {
        color: palette.casing,
        width: dim ? 4 : 7,
      });
      drawLines(map, line, [coords], {
        color,
        width: dim ? 2 : 4,
        ...(road ? {} : { dash: [2, 1.5] }),
      });
      if (map.getLayer(line))
        map.setPaintProperty(line, "line-opacity", dim ? 0.35 : 1);
      layers.current.push(casing, line);

      route.stops.forEach((s, i) => {
        const q = inst.requests[s.r];
        const p = s.kind === "P" && q.pickup ? q.pickup : q.delivery;
        const el = document.createElement("button");
        el.type = "button";
        el.className = `rl-pin${s.kind === "D" ? " is-delivery" : ""}`;
        el.style.setProperty("--pin", color);
        el.style.opacity = dim ? "0.45" : "1";
        el.textContent = String(i + 1);
        el.setAttribute(
          "aria-label",
          `Truck ${k + 1}, stop ${i + 1}: ${s.kind === "P" ? "pickup" : "delivery"}`,
        );
        markers.current.push(
          new gl.Marker({ element: el })
            .setLngLat([p.lng, p.lat])
            .setPopup(
              new gl.Popup({ offset: 14, closeButton: false }).setText(
                `Truck ${k + 1} · stop ${i + 1} · ${s.kind === "P" ? "pickup" : "delivery"}`,
              ),
            )
            .addTo(map),
        );
      });
    });

    const depot = document.createElement("div");
    depot.className = "rl-depot";
    depot.setAttribute("role", "img");
    depot.setAttribute("aria-label", "Depot");
    depot.textContent = "D";
    markers.current.push(
      new gl.Marker({ element: depot })
        .setLngLat([inst.depot.lng, inst.depot.lat])
        .addTo(map),
    );
  }, [mapState, inst, plan, roads, followRoads, selected, palette.casing]);

  // Fit on a new scenario or when asked, not on every selection change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: fitSignal re-runs the fit on demand
  useEffect(() => {
    if (!mapState) return;
    const pts = [
      { latitude: inst.depot.lat, longitude: inst.depot.lng },
      ...inst.requests.flatMap((r) =>
        [r.pickup, r.delivery]
          .filter((p): p is NonNullable<typeof p> => p != null)
          .map((p) => ({ latitude: p.lat, longitude: p.lng })),
      ),
    ];
    fitToPoints(mapState.map, pts, { x: 48, top: 48, bottom: 48 }, 15);
  }, [mapState, inst, fitSignal]);

  if (!hasMapbox) {
    return (
      <p className="mh-empty">
        Add NEXT_PUBLIC_MAPBOX_TOKEN to show the real map.
      </p>
    );
  }
  return (
    <div className="rl-map-frame">
      <section
        ref={container}
        className="rl-map"
        aria-label="Planned routes on the Yangon map"
      />
      {!mapState && <p className="rl-map-loading">Loading map…</p>}
    </div>
  );
}

const SOURCE_TONE: Record<DataSourceInfo["state"], Tone> = {
  active: "success",
  available: "info",
  missing: "warning",
};

function SourcesTable() {
  const [sources, setSources] = useState<DataSourceInfo[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    fetch("/api/dispatch/sources")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(
        (body: { sources: DataSourceInfo[] }) =>
          live && setSources(body.sources),
      )
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const connected = sources?.filter((s) => s.state === "active").length ?? 0;
  return (
    <Container
      id="rl-sources-title"
      title="Data sources"
      count={
        sources ? `${connected} of ${sources.length} connected` : undefined
      }
      description="Every input the routing engine could use, and whether it is actually wired in."
    >
      {failed ? (
        <p className="mh-empty">Could not load data sources.</p>
      ) : !sources ? (
        <p className="mh-empty">Checking data sources…</p>
      ) : (
        <div className="mh-table-wrap">
          <table className="mh-table">
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">Type</th>
                <th scope="col">Status</th>
                <th scope="col">What it does</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id}>
                  <th scope="row" className="rl-source-name">
                    {s.name}
                  </th>
                  <td className="mh-muted mh-nowrap">{s.category}</td>
                  <td className="mh-nowrap">
                    <StatusIndicator tone={SOURCE_TONE[s.state]}>
                      {STATE_LABEL[s.state]}
                    </StatusIndicator>
                  </td>
                  <td className="mh-muted">{s.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Container>
  );
}

export function ManagerRoutingApp() {
  const workspace = useWorkspace("manager");
  const [authOpen, setAuthOpen] = useState(false);
  const [orders, setOrders] = useState(14);
  const [trucks, setTrucks] = useState(3);
  const [seed, setSeed] = useState(16);
  const [selected, setSelected] = useState<number | null>(null);
  const [followRoads, setFollowRoads] = useState(true);
  const [fitSignal, setFitSignal] = useState(0);
  const [roadState, setRoadState] = useState<
    "off" | "loading" | "ready" | "fallback"
  >("off");
  const onRoadState = useCallback(setRoadState, []);
  const dOrders = useDeferredValue(orders);
  const dTrucks = useDeferredValue(trucks);
  const dSeed = useDeferredValue(seed);
  const lab = useMemo(
    () => runLab(dOrders, dTrucks, dSeed),
    [dOrders, dTrucks, dSeed],
  );
  const { certificate: c, plan } = lab;
  const total = lab.inst.requests.length;
  const served = total - plan.unassigned.length;
  const km = plan.routes.reduce((sum, r) => sum + r.eval.km, 0);
  const used = plan.routes.filter((r) => r.stops.length);
  const unplacedReasons = [
    ...new Set(plan.unassigned.map((u) => u.reason.replace(/_/g, " "))),
  ];
  const exact = c.exactOptimum != null;
  const optimal = exact && c.exactGapPct != null && c.exactGapPct < 0.01;
  const stale = orders !== dOrders || trucks !== dTrucks || seed !== dSeed;

  const metrics = [
    {
      label: "Orders placed",
      value: served,
      hint:
        served === total
          ? `All ${total} placed`
          : `${total - served} not placed`,
      tone: (served === total ? "success" : "warning") as Tone,
    },
    {
      label: "Trucks used",
      value: used.length,
      hint: `of ${lab.inst.trucks.length} available`,
      tone: "info" as Tone,
    },
    {
      label: "Distance (km)",
      value: Math.round(km),
      hint: "All routes combined",
      tone: "muted" as Tone,
    },
    {
      label: "Search steps",
      value: plan.iterations,
      hint: plan.stopReason === "converged" ? "Converged" : plan.stopReason,
      tone: "muted" as Tone,
    },
  ];

  const checks: {
    name: string;
    detail: string;
    tone: Tone;
    status: string;
  }[] = [
    {
      name: "Independent check",
      detail:
        "A separate re-simulation of every route looks for broken rules: capacity, time windows, stop order, shift length.",
      tone: lab.violations.length ? "error" : "success",
      status: lab.violations.length
        ? `${lab.violations.length} problems`
        : "Passed",
    },
    {
      name: "Repeatable",
      detail: `Solved twice from the same inputs. Fingerprint ${plan.hash}.`,
      tone: lab.reproducible ? "success" : "error",
      status: lab.reproducible ? "Same plan" : "Plans differ",
    },
    {
      name: "Best possible",
      detail: exact
        ? "Every possible plan was tried; none scored better."
        : `Exact search runs at ${MAX_EXACT_ORDERS} orders or fewer.`,
      tone: exact ? (optimal ? "success" : "warning") : "muted",
      status: exact
        ? optimal
          ? "Proven optimal"
          : `${c.exactGapPct?.toFixed(2)}% over`
        : "Not run",
    },
    {
      name: "Guaranteed floor",
      detail: plan.unassigned.length
        ? `Not comparable: ${unplacedReasons.join(", ")} left ${plan.unassigned.length} order(s) out.`
        : `No plan can score below ${c.lowerBound.toFixed(0)}; this one scores ${c.objective.toFixed(0)}. The floor is loose, so the gap shows the most waste possible.`,
      tone: "muted",
      status: plan.unassigned.length ? "Not shown" : "Valid",
    },
  ];

  return (
    <ConsoleShell
      active="routing"
      workspace={workspace}
      onSignIn={() => setAuthOpen(true)}
    >
      <div className="manager-content">
        <PageHeader
          title="Route lab"
          description="Plan a day with the routing engine, then check the proof that the plan is valid, repeatable and close to the best possible."
        />
        <div className="mh-page" aria-busy={stale}>
          <Container
            id="rl-summary-title"
            title="Plan summary"
            description="Updates as you change the scenario."
          >
            <ul className="mh-metrics rl-metrics">
              {metrics.map((m) => (
                <li key={m.label}>
                  <div>
                    <span className="mh-metric-label">{m.label}</span>
                    <strong className={`is-${m.tone}`}>{m.value}</strong>
                    <StatusIndicator tone={m.tone}>{m.hint}</StatusIndicator>
                  </div>
                </li>
              ))}
            </ul>
          </Container>

          <div className="mh-columns">
            <div className="mh-stack">
              <Container
                id="rl-map-title"
                title="Planned routes"
                description="Numbered pins are stops in order: filled are deliveries, hollow are pickups. D is the depot. Drag and scroll to explore."
              >
                <div className="rl-body">
                  <div className="rl-toolbar">
                    <label className="rl-toggle">
                      <input
                        type="checkbox"
                        checked={followRoads}
                        onChange={(e) => setFollowRoads(e.target.checked)}
                      />
                      Follow real roads
                    </label>
                    <StatusIndicator
                      tone={
                        roadState === "ready"
                          ? "success"
                          : roadState === "fallback"
                            ? "warning"
                            : "muted"
                      }
                    >
                      {roadState === "ready"
                        ? "Road routes"
                        : roadState === "loading"
                          ? "Loading roads…"
                          : roadState === "fallback"
                            ? "Some straight lines"
                            : "Straight lines"}
                    </StatusIndicator>
                    <button
                      type="button"
                      className="rl-btn"
                      onClick={() => setFitSignal((n) => n + 1)}
                    >
                      Fit to routes
                    </button>
                  </div>
                  <RouteMap
                    inst={lab.inst}
                    plan={plan}
                    selected={selected}
                    followRoads={followRoads}
                    fitSignal={fitSignal}
                    onRoadState={onRoadState}
                  />
                  <ul className="rl-legend">
                    {plan.routes.map((r, k) =>
                      r.stops.length ? (
                        <li key={r.truckId}>
                          <button
                            type="button"
                            className="rl-chip"
                            aria-pressed={selected === k}
                            onClick={() =>
                              setSelected(selected === k ? null : k)
                            }
                          >
                            <i
                              style={{
                                background:
                                  ROUTE_COLORS[k % ROUTE_COLORS.length],
                              }}
                            />
                            <strong>Truck {k + 1}</strong>
                            <span>
                              {new Set(r.stops.map((s) => s.r)).size} orders ·{" "}
                              {r.eval.km.toFixed(1)} km
                            </span>
                          </button>
                        </li>
                      ) : null,
                    )}
                  </ul>
                  {plan.unassigned.length > 0 && (
                    <p className="rl-unplaced">
                      <StatusIndicator tone="warning">
                        {plan.unassigned.length} order(s) not placed
                      </StatusIndicator>
                      {unplacedReasons.join(", ")}
                    </p>
                  )}
                </div>
              </Container>
            </div>

            <div className="mh-stack">
              <Container
                id="rl-scenario-title"
                title="Scenario"
                description="Same inputs always give the same plan."
              >
                <div className="rl-body rl-controls">
                  <label>
                    <span>
                      Orders <output>{orders}</output>
                    </span>
                    <input
                      type="range"
                      min={3}
                      max={40}
                      value={orders}
                      onChange={(e) => setOrders(Number(e.target.value))}
                    />
                  </label>
                  <label>
                    <span>
                      Trucks <output>{trucks}</output>
                    </span>
                    <input
                      type="range"
                      min={1}
                      max={6}
                      value={trucks}
                      onChange={(e) => setTrucks(Number(e.target.value))}
                    />
                  </label>
                  <label>
                    <span>Seed</span>
                    <input
                      type="number"
                      min={1}
                      max={9999}
                      value={seed}
                      onChange={(e) =>
                        setSeed(Math.max(1, Number(e.target.value) || 1))
                      }
                    />
                  </label>
                </div>
              </Container>

              <Container
                id="rl-proof-title"
                title="Proof"
                description="Four checks on the plan above."
              >
                <ul className="mh-health">
                  {checks.map((check) => (
                    <li key={check.name}>
                      <div className="rl-check">
                        <span className="mh-health-copy">
                          <strong>{check.name}</strong>
                          <small>{check.detail}</small>
                        </span>
                        <StatusIndicator tone={check.tone}>
                          {check.status}
                        </StatusIndicator>
                      </div>
                    </li>
                  ))}
                </ul>
              </Container>
            </div>
          </div>

          <SourcesTable />
        </div>
      </div>
      <AuthDialog
        open={authOpen}
        audience="team"
        onClose={() => setAuthOpen(false)}
      />
    </ConsoleShell>
  );
}
