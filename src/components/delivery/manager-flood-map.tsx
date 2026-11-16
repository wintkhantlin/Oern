"use client";

import type { GeoJSONSource, MapLayerMouseEvent } from "mapbox-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Icon } from "@/components/delivery/icons";
import { fitToPoints, useMapboxMap } from "@/components/delivery/mapbox-kit";
import { type FloodZone, floodZoneAt } from "@/lib/delivery/flood-zones";
import { hasMapbox } from "@/lib/delivery/mapbox";

export type FloodPoint = {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  kind: "request" | "task";
};

const WIDTH = 520;
const HEIGHT = 300;
const PAD = 16;
const SOURCE_ID = "manager-flood-zones";

function fallbackProjection(zones: FloodZone[], points: FloodPoint[]) {
  const all: [number, number][] = [
    ...zones.flatMap((zone) => zone.coordinates),
    ...points.map(
      (point) => [point.longitude, point.latitude] as [number, number],
    ),
  ];
  if (all.length === 0) {
    return { x: () => WIDTH / 2, y: () => HEIGHT / 2 };
  }

  const lngs = all.map(([lng]) => lng);
  const lats = all.map(([, lat]) => lat);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const lngScale = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const spanX = Math.max((maxLng - minLng) * lngScale, 0.001);
  const spanY = Math.max(maxLat - minLat, 0.001);
  const scale = Math.min((WIDTH - PAD * 2) / spanX, (HEIGHT - PAD * 2) / spanY);
  const offsetX = (WIDTH - spanX * scale) / 2;
  const offsetY = (HEIGHT - spanY * scale) / 2;
  return {
    x: (lng: number) => offsetX + (lng - minLng) * lngScale * scale,
    y: (lat: number) => HEIGHT - offsetY - (lat - minLat) * scale,
  };
}

function FloodMapFallback({
  zones,
  points,
  activeId,
}: {
  zones: FloodZone[];
  points: FloodPoint[];
  activeId: string | null;
}) {
  const view = useMemo(
    () => fallbackProjection(zones, points),
    [zones, points],
  );

  return (
    <svg
      className="flood-map-fallback"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label="Schematic fallback showing mapped flood zones and dispatch stops"
    >
      {[...zones]
        .sort((a, b) => a.hazardClass - b.hazardClass)
        .map((zone) => (
          <polygon
            key={zone.id}
            className="flood-zone"
            data-class={zone.hazardClass}
            data-active={zone.id === activeId || undefined}
            points={zone.coordinates
              .map(([lng, lat]) => `${view.x(lng)},${view.y(lat)}`)
              .join(" ")}
          />
        ))}
      {points.map((point) => {
        const zone = floodZoneAt(point.latitude, point.longitude, zones);
        return (
          <g
            key={`${point.kind}-${point.id}`}
            transform={`translate(${view.x(point.longitude)} ${view.y(point.latitude)})`}
            className="flood-point"
            data-kind={point.kind}
            data-exposed={zone ? "true" : undefined}
            data-class={zone?.hazardClass}
          >
            <title>
              {point.label}
              {zone ? `, inside ${zone.name}` : ""}
            </title>
            {zone && <circle className="flood-point-ring" r="11" />}
            {point.kind === "request" ? (
              <circle r="5" />
            ) : (
              <rect x="-5" y="-5" width="10" height="10" rx="2" />
            )}
          </g>
        );
      })}
    </svg>
  );
}

type FloodMapProps = {
  zones: FloodZone[];
  points: FloodPoint[];
  activeId: string | null;
  onSelectZone: (id: string) => void;
  onHoverZone: (id: string | null) => void;
};

function MapboxFloodMap({
  zones,
  points,
  activeId,
  onSelectZone,
  onHoverZone,
}: FloodMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapState = useMapboxMap(container, true);
  const markers = useRef<{ remove: () => void }[]>([]);
  const [timedOut, setTimedOut] = useState(false);
  const fitPoints = useMemo(
    () => [
      ...zones.map((zone) => zone.center),
      ...points.map((point) => ({
        latitude: point.latitude,
        longitude: point.longitude,
      })),
    ],
    [zones, points],
  );
  const fitMap = useCallback(() => {
    if (!mapState) return;
    fitToPoints(mapState.map, fitPoints, { x: 48, top: 48, bottom: 48 }, 13.5);
  }, [fitPoints, mapState]);

  useEffect(() => {
    if (mapState) {
      setTimedOut(false);
      return;
    }
    const timer = window.setTimeout(() => setTimedOut(true), 7000);
    return () => window.clearTimeout(timer);
  }, [mapState]);

  useEffect(() => {
    if (!mapState) return;
    const { map } = mapState;
    const data = {
      type: "FeatureCollection" as const,
      features: zones.map((zone) => ({
        type: "Feature" as const,
        id: zone.id,
        properties: {
          id: zone.id,
          name: zone.name,
          hazardClass: zone.hazardClass,
        },
        geometry: {
          type: "Polygon" as const,
          coordinates: [zone.coordinates],
        },
      })),
    };
    const source = map.getSource<GeoJSONSource>(SOURCE_ID);
    if (source) {
      source.setData(data);
      return;
    }
    map.addSource(SOURCE_ID, { type: "geojson", data });
    map.addLayer({
      id: `${SOURCE_ID}-fill`,
      type: "fill",
      source: SOURCE_ID,
      paint: {
        "fill-color": [
          "match",
          ["get", "hazardClass"],
          3,
          "#DC2626",
          2,
          "#D97706",
          "#EAB308",
        ],
        "fill-opacity": [
          "case",
          ["boolean", ["feature-state", "active"], false],
          0.52,
          ["match", ["get", "hazardClass"], 3, 0.3, 2, 0.24, 0.16],
        ],
      },
    });
    map.addLayer({
      id: `${SOURCE_ID}-line`,
      type: "line",
      source: SOURCE_ID,
      paint: {
        "line-color": [
          "match",
          ["get", "hazardClass"],
          3,
          "#B91C1C",
          2,
          "#92400E",
          "#A16207",
        ],
        "line-width": [
          "case",
          ["boolean", ["feature-state", "active"], false],
          3,
          1.5,
        ],
      },
    });
  }, [mapState, zones]);

  useEffect(() => {
    if (!mapState) return;
    for (const zone of zones) {
      mapState.map.setFeatureState(
        { source: SOURCE_ID, id: zone.id },
        { active: zone.id === activeId },
      );
    }
  }, [activeId, mapState, zones]);

  useEffect(() => {
    if (!mapState) return;
    const { map } = mapState;
    const fillLayer = `${SOURCE_ID}-fill`;
    const zoneId = (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0] as unknown as
        | { properties?: { id?: unknown } }
        | undefined;
      const id = feature?.properties?.id;
      return typeof id === "string" ? id : null;
    };
    const onClick = (event: MapLayerMouseEvent) => {
      const id = zoneId(event);
      if (id) onSelectZone(id);
    };
    const onMove = (event: MapLayerMouseEvent) => {
      map.getCanvas().style.cursor = "pointer";
      onHoverZone(zoneId(event));
    };
    const onLeave = () => {
      map.getCanvas().style.cursor = "";
      onHoverZone(null);
    };
    map.on("click", fillLayer, onClick);
    map.on("mousemove", fillLayer, onMove);
    map.on("mouseleave", fillLayer, onLeave);
    return () => {
      map.off("click", fillLayer, onClick);
      map.off("mousemove", fillLayer, onMove);
      map.off("mouseleave", fillLayer, onLeave);
      map.getCanvas().style.cursor = "";
    };
  }, [mapState, onHoverZone, onSelectZone]);

  useEffect(() => {
    if (!mapState) return;
    const { map, gl } = mapState;
    for (const marker of markers.current) marker.remove();
    markers.current = points.map((point) => {
      const zone = floodZoneAt(point.latitude, point.longitude, zones);
      const element = document.createElement("button");
      element.type = "button";
      element.className = "flood-map-marker";
      element.dataset.kind = point.kind;
      if (zone) {
        element.dataset.exposed = "true";
        element.dataset.class = String(zone.hazardClass);
      }
      const context = zone ? `inside ${zone.name}` : "outside mapped zones";
      element.setAttribute("aria-label", `${point.label}, ${context}`);
      element.title = `${point.label}, ${context}`;
      element.addEventListener("click", () => {
        if (zone) onSelectZone(zone.id);
      });
      element.addEventListener("mouseenter", () => {
        onHoverZone(zone?.id ?? null);
      });
      element.addEventListener("mouseleave", () => onHoverZone(null));
      return new gl.Marker({ element, anchor: "center" })
        .setLngLat([point.longitude, point.latitude])
        .setPopup(
          new gl.Popup({ offset: 18, closeButton: false }).setText(
            `${point.label} · ${context}`,
          ),
        )
        .addTo(map);
    });
    return () => {
      for (const marker of markers.current) marker.remove();
      markers.current = [];
    };
  }, [mapState, onHoverZone, onSelectZone, points, zones]);

  useEffect(() => {
    if (!mapState) return;
    const control = new mapState.gl.NavigationControl({ showCompass: false });
    mapState.map.addControl(control, "top-right");
    return () => {
      mapState.map.removeControl(control);
    };
  }, [mapState]);

  useEffect(() => {
    fitMap();
  }, [fitMap]);

  return (
    <div className="flood-map-frame" data-ready={mapState ? "true" : undefined}>
      <section
        ref={container}
        className="flood-mapbox"
        aria-label="Interactive Yangon flood risk map"
      />
      {!mapState && !timedOut && (
        <output className="flood-map-status" aria-live="polite">
          Loading street map…
        </output>
      )}
      {!mapState && timedOut && (
        <div className="flood-map-fallback-wrap">
          <FloodMapFallback zones={zones} points={points} activeId={activeId} />
          <output className="flood-map-status" aria-live="polite">
            Street map unavailable. Showing the geographic fallback.
          </output>
        </div>
      )}
      {mapState && (
        <button type="button" className="flood-map-fit" onClick={fitMap}>
          <Icon name="location" size={16} />
          Fit map
        </button>
      )}
    </div>
  );
}

export function FloodMap(props: FloodMapProps) {
  if (!hasMapbox) {
    return (
      <div className="flood-map-fallback-wrap is-immediate">
        <FloodMapFallback
          zones={props.zones}
          points={props.points}
          activeId={props.activeId}
        />
        <output className="flood-map-status" aria-live="polite">
          Street map is not configured. Showing the geographic fallback.
        </output>
      </div>
    );
  }
  return <MapboxFloodMap {...props} />;
}
