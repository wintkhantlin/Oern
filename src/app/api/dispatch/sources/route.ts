import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

import fuel from "@/lib/delivery/data/yangon-google-fuel-stations.json";
import vendors from "@/lib/delivery/data/yangon-food-vendors.json";
import traffic from "@/lib/delivery/data/yangon-traffic-points.json";
import { ALL_YANGON_INTERCEPTION_POINTS } from "@/lib/delivery/data/yangon-interception-points";
import { YUTRA_CONGESTION } from "@/lib/delivery/data/yutra-network";
import { YUTRA_SIGNAL_DELAYS } from "@/lib/delivery/data/yutra-signal-delays";
import { loadOsmGraph } from "@/lib/delivery/dispatch/osm-matrix";
import { describeSources } from "@/lib/delivery/dispatch/data-sources";

async function yutraRawFileCount() {
  try {
    const dir = path.join(process.cwd(), "data", "yutra_raw");
    return (await readdir(dir)).filter((name) => !name.startsWith(".")).length;
  } catch {
    return 0;
  }
}

async function osmMb() {
  try {
    const info = await stat(path.join(process.cwd(), "data", "yangon.osm.pbf"));
    return Math.round(info.size / 1_048_576);
  } catch {
    return null;
  }
}

export async function GET() {
  const sources = describeSources({
    mapboxToken: Boolean(
      process.env.MAPBOX_SERVER_TOKEN ?? process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
    ),
    supabase: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    anthropicKey: Boolean(
      process.env.GEMINI_API_KEY ??
        process.env.GOOGLE_API_KEY ??
        process.env.ANTHROPIC_API_KEY,
    ),
    yutraSignals: YUTRA_SIGNAL_DELAYS.length,
    yutraRawFiles: await yutraRawFileCount(),
    osmExtractMb: await osmMb(),
    osmGraphNodes: (await loadOsmGraph())?.n ?? 0,
    yutraCongestion: YUTRA_CONGESTION.length,
    trafficPoints: traffic.length,
    fuelStations: fuel.length,
    foodVendors: vendors.length,
    interceptionPoints: ALL_YANGON_INTERCEPTION_POINTS.length,
  });
  return NextResponse.json({ sources });
}
