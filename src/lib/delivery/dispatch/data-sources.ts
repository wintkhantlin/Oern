/*
 * One honest list of every data source the routing engine could use: what it
 * is, whether it can be reached right now, and whether the planner actually
 * reads it today. Pure, so it is easy to test; the API route supplies facts.
 */

export type SourceState =
  /** Reachable and read by the planner. */
  | "active"
  /** Reachable, but the planner does not read it yet. */
  | "available"
  /** Needs configuration or data that is not present. */
  | "missing";

export type SourceFacts = {
  mapboxToken: boolean;
  supabase: boolean;
  /** A road-intel model key is set (Gemini / AI Studio or Anthropic). */
  anthropicKey: boolean;
  /** Surveyed signals feeding the traffic layer. */
  yutraSignals: number;
  /** Raw YUTRA files on disk (speeds, volumes, congestion, turns). */
  yutraRawFiles: number;
  osmExtractMb: number | null;
  /** Junctions in the generated OSM routing graph; 0 when not built. */
  osmGraphNodes?: number;
  /** Surveyed YUTRA junction congestion rows feeding the traffic layer. */
  yutraCongestion?: number;
  trafficPoints: number;
  fuelStations: number;
  foodVendors: number;
  interceptionPoints: number;
};

export type DataSourceInfo = {
  id: string;
  name: string;
  category: "road network" | "traffic" | "weather" | "fleet" | "places";
  state: SourceState;
  /** What the planner does with it, or what is stopping that. */
  detail: string;
  usedByPlanner: boolean;
};

export function describeSources(f: SourceFacts): DataSourceInfo[] {
  return [
    {
      id: "mapbox-matrix",
      name: "Mapbox road matrix",
      category: "road network",
      state: f.mapboxToken ? "active" : "missing",
      detail: f.mapboxToken
        ? "Real driving times and distances between every stop."
        : "No token set, so plans fall back to straight-line estimates.",
      usedByPlanner: true,
    },
    {
      id: "flood",
      name: "Flood layer and verified reports",
      category: "weather",
      state: f.supabase ? "active" : "missing",
      detail: f.supabase
        ? "Hazard zones slow or block arcs through flooded roads."
        : "Needs Supabase to load flood layers and road reports.",
      usedByPlanner: true,
    },
    {
      id: "open-meteo",
      name: "Open-Meteo live rain and river data",
      category: "weather",
      state: "active",
      detail: "Public API, no key. Heavy rain raises the flood slowdown.",
      usedByPlanner: true,
    },
    {
      id: "interception",
      name: "Traffic interception points",
      category: "traffic",
      state: "active",
      detail: `${f.interceptionPoints} Yangon signals and junctions add localized delay.`,
      usedByPlanner: true,
    },
    {
      id: "traffic-points",
      name: "Traffic light survey",
      category: "traffic",
      state: f.trafficPoints ? "active" : "missing",
      detail: `${f.trafficPoints} hand-mapped signals. They are the same points as the interception data above, so they are already in use.`,
      usedByPlanner: true,
    },
    {
      id: "yutra-signals",
      name: "YUTRA measured signal delays",
      category: "traffic",
      state: f.yutraSignals ? "active" : "missing",
      detail: `${f.yutraSignals} surveyed signals (2013). Measured delay replaces the modelled one at known junctions and fills downtown gaps the model had none for.`,
      usedByPlanner: true,
    },
    {
      id: "yutra-rest",
      name: "YUTRA speeds, volumes and congestion",
      category: "traffic",
      state: f.yutraCongestion ? "active" : f.yutraRawFiles > 1 ? "available" : "missing",
      detail: f.yutraCongestion
        ? `${f.yutraCongestion} surveyed junction-period readings. During the surveyed peak (07:30-09:30) and off-peak (14:00-16:00) windows, congested junctions add queueing delay to arcs passing them. Road speed limits and turn splits are loaded but not routed: 2013 values for ~15 roads cannot cover whole arcs.`
        : f.yutraRawFiles > 1
          ? `${f.yutraRawFiles} raw files on hand but not yet built into the planner. Run scripts/build-yutra-data.mjs.`
          : "No raw YUTRA files on disk.",
      usedByPlanner: Boolean(f.yutraCongestion),
    },
    {
      id: "fuel",
      name: "Fuel stations",
      category: "fleet",
      state: "active",
      detail: `${f.fuelStations} stations used for fuel and battery stop planning.`,
      usedByPlanner: false,
    },
    {
      id: "osm",
      name: "OpenStreetMap Yangon extract",
      category: "road network",
      state: f.osmGraphNodes ? "active" : f.osmExtractMb != null ? "available" : "missing",
      detail: f.osmGraphNodes
        ? `${f.osmGraphNodes.toLocaleString("en")} junctions in a routing graph built from the ${f.osmExtractMb ?? "?"} MB extract. Plans use it for real road distances (one-way aware) whenever Mapbox is unavailable, instead of straight lines.`
        : f.osmExtractMb != null
          ? `${f.osmExtractMb} MB extract on disk, but no graph is built. Run python3 scripts/build-osm-graph.py.`
          : "No extract on disk.",
      usedByPlanner: Boolean(f.osmGraphNodes),
    },
    {
      id: "vendors",
      name: "Food vendor locations",
      category: "places",
      state: f.foodVendors ? "active" : "missing",
      detail: `${f.foodVendors} vendors served by GET /api/places/vendors for nearest-pickup suggestions. Not a routing input.`,
      usedByPlanner: false,
    },
    {
      id: "road-intel",
      name: "AI road report analysis (Gemini / Claude)",
      category: "traffic",
      state: f.anthropicKey ? "active" : "missing",
      detail: f.anthropicKey
        ? "Rider road reports are reviewed before they affect ETAs."
        : "No GEMINI_API_KEY or ANTHROPIC_API_KEY, so reports use the rule-based reviewer.",
      usedByPlanner: false,
    },
  ];
}
