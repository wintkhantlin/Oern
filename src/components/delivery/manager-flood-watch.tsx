"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Icon } from "@/components/delivery/icons";
import {
  FloodMap,
  type FloodPoint,
} from "@/components/delivery/manager-flood-map";
import {
  fetchLiveFloodConditions,
  type LiveFloodConditions,
} from "@/lib/delivery/dispatch/open-meteo";
import {
  type FloodHazardClass,
  type FloodZone,
  floodZoneAt,
} from "@/lib/delivery/flood-zones";
import "./manager-flood-watch.css";

const HAZARD_LABELS: Record<FloodHazardClass, string> = {
  1: "Class 1, 10–25 cm",
  2: "Class 2, 25–50 cm",
  3: "Class 3, over 50 cm",
};

const CONDITION_LABELS: Record<string, string> = {
  clear: "Clear",
  light_rain: "Light rain",
  heavy_rain: "Heavy rain",
  flood_risk: "Flood risk",
};

const TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

function updatedAtLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return TIME_FORMATTER.format(date);
}

export function FloodWatch({
  zones,
  points,
  unmappedCount = 0,
}: {
  zones: FloodZone[];
  points: FloodPoint[];
  unmappedCount?: number;
}) {
  const [live, setLive] = useState<LiveFloodConditions | null>(null);
  const [liveFailed, setLiveFailed] = useState(false);
  const [liveLoading, setLiveLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const liveRequestId = useRef(0);

  const loadLiveConditions = useCallback(() => {
    const requestId = ++liveRequestId.current;
    setLiveLoading(true);
    setLiveFailed(false);
    void fetchLiveFloodConditions({ lat: 16.8007, lng: 96.15 })
      .then((conditions) => {
        if (requestId !== liveRequestId.current) return;
        if (conditions) {
          setLive(conditions);
        } else {
          setLiveFailed(true);
        }
      })
      .catch(() => {
        if (requestId === liveRequestId.current) setLiveFailed(true);
      })
      .finally(() => {
        if (requestId === liveRequestId.current) setLiveLoading(false);
      });
  }, []);

  useEffect(() => {
    const requestId = ++liveRequestId.current;
    void fetchLiveFloodConditions({ lat: 16.8007, lng: 96.15 })
      .then((conditions) => {
        if (requestId !== liveRequestId.current) return;
        if (conditions) {
          setLive(conditions);
        } else {
          setLiveFailed(true);
        }
      })
      .catch(() => {
        if (requestId === liveRequestId.current) {
          setLiveFailed(true);
        }
      })
      .finally(() => {
        if (requestId === liveRequestId.current) {
          setLiveLoading(false);
        }
      });
    return () => {
      if (requestId === liveRequestId.current) {
        liveRequestId.current += 1;
      }
    };
  }, []);

  const hit = useMemo(
    () =>
      points.map((point) => ({
        point,
        zone: floodZoneAt(point.latitude, point.longitude, zones),
      })),
    [points, zones],
  );
  const exposed = hit
    .filter(
      (item): item is { point: FloodPoint; zone: FloodZone } =>
        item.zone !== null,
    )
    .sort((a, b) => b.zone.hazardClass - a.zone.hazardClass);
  const activeId = hoveredId ?? selectedId;
  const active = zones.find((zone) => zone.id === activeId) ?? null;
  const severity = live
    ? (CONDITION_LABELS[live.severity] ?? live.severity)
    : null;
  const updatedAt = live ? updatedAtLabel(live.fetchedAt) : null;

  return (
    <section className="flood-watch" aria-labelledby="flood-watch-title">
      <header className="flood-watch-head">
        <div>
          <h2 id="flood-watch-title">Flood watch</h2>
          <p className="flood-watch-description">
            Mapped risk zones and current Yangon conditions.
          </p>
        </div>
        <div className="flood-live-group">
          <p
            className="flood-live"
            data-severity={live?.severity ?? "unknown"}
            aria-live="polite"
          >
            {live ? (
              <>
                <strong>{severity}</strong>
                <span>
                  {live.precipitationMm.toFixed(1)} mm precipitation
                  {live.riverDischargeM3s != null
                    ? `, river ${live.riverDischargeM3s.toFixed(1)} m³/s`
                    : ""}
                  {live.suggestedSlowdown > 0
                    ? `, add ${Math.round(live.suggestedSlowdown * 100)}% travel time`
                    : ""}
                </span>
                {updatedAt && <small>Updated {updatedAt}</small>}
                {liveFailed && (
                  <small>Refresh failed; showing the last reading.</small>
                )}
              </>
            ) : (
              <span>
                {liveFailed
                  ? "Live conditions unavailable. Showing mapped zones only."
                  : "Checking live conditions…"}
              </span>
            )}
          </p>
          <button
            type="button"
            className="flood-refresh"
            onClick={() => void loadLiveConditions()}
            disabled={liveLoading}
          >
            <Icon name="refresh" size={16} />
            {liveLoading ? "Checking…" : "Refresh conditions"}
          </button>
        </div>
      </header>

      <div className="flood-watch-body">
        <figure className="flood-map">
          <FloodMap
            zones={zones}
            points={points}
            activeId={activeId}
            onSelectZone={setSelectedId}
            onHoverZone={setHoveredId}
          />
          <figcaption>
            <strong className="flood-caption-title">Mapped risk zones</strong>
            <ul className="flood-legend">
              {([1, 2, 3] as FloodHazardClass[]).map((level) => (
                <li key={level} data-class={level}>
                  {HAZARD_LABELS[level]}
                </li>
              ))}
              <li className="flood-legend-point">
                <svg width="10" height="10" aria-hidden="true">
                  <circle cx="5" cy="5" r="5" />
                </svg>
                Request
              </li>
              <li className="flood-legend-point" data-kind="task">
                <svg width="10" height="10" aria-hidden="true">
                  <rect width="10" height="10" rx="2" />
                </svg>
                Task
              </li>
            </ul>
            {zones.length > 0 ? (
              <fieldset className="flood-zone-list">
                <legend className="visually-hidden">Flood risk zones</legend>
                {zones.map((zone) => (
                  <button
                    key={zone.id}
                    type="button"
                    data-class={zone.hazardClass}
                    aria-pressed={zone.id === selectedId}
                    aria-controls="flood-zone-readout"
                    onClick={() => setSelectedId(zone.id)}
                    onFocus={() => setSelectedId(zone.id)}
                    onMouseEnter={() => setHoveredId(zone.id)}
                    onMouseLeave={() => setHoveredId(null)}
                  >
                    <span>{zone.name}</span>
                    <small>Class {zone.hazardClass}</small>
                  </button>
                ))}
              </fieldset>
            ) : (
              <p className="flood-map-empty">
                No mapped flood zones available.
              </p>
            )}
            <span
              id="flood-zone-readout"
              className="flood-zone-readout"
              aria-live="polite"
            >
              {active
                ? `${active.name}, ${active.waterDepthEstimateCm} cm estimated depth, ${active.advisory}`
                : zones.length > 0
                  ? "Select a mapped zone for its dispatch advisory."
                  : "Dispatch stops cannot be checked until a flood-zone layer is available."}
            </span>
          </figcaption>
        </figure>

        <div className="flood-exposure">
          <h3>
            {points.length === 0
              ? "No mapped dispatch stops"
              : `${exposed.length} of ${points.length} mapped stops exposed`}
          </h3>
          {unmappedCount > 0 && (
            <p className="flood-unmapped-note">
              {unmappedCount} active{" "}
              {unmappedCount === 1 ? "stop is" : "stops are"} not checked
              because {unmappedCount === 1 ? "its" : "their"} location is
              missing.
            </p>
          )}
          {exposed.length ? (
            <ul>
              {exposed.map(({ point, zone }) => (
                <li
                  key={`${point.kind}-${point.id}`}
                  data-class={zone.hazardClass}
                >
                  <Icon name="flood" size={16} />
                  <span>
                    <strong>{point.label}</strong>
                    <span>
                      {zone.name}, class {zone.hazardClass},{" "}
                      {zone.waterDepthEstimateCm} cm estimated depth
                    </span>
                    <small>{zone.advisory}</small>
                  </span>
                </li>
              ))}
            </ul>
          ) : points.length === 0 ? (
            <p>
              Active requests and tasks appear here after a drop-off location is
              saved.
            </p>
          ) : zones.length === 0 ? (
            <p>
              Located stops are ready, but no flood-zone layer is available.
            </p>
          ) : (
            <p>
              No located active stops intersect the {zones.length} mapped risk{" "}
              {zones.length === 1 ? "zone" : "zones"}.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
