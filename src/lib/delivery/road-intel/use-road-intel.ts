import { useEffect, useMemo, useRef, useState } from "react";
import { Observable, of, timer } from "rxjs";
import { catchError, shareReplay, switchMap } from "rxjs/operators";
import { useObservable } from "../../rxjs/use-observable.ts";
import type { RoadReport } from "../types.ts";
import type { SpeedCell } from "./types.ts";

export const SPEED_REFRESH_MS = 90_000;
const EMPTY_CELLS: SpeedCell[] = [];

type SpeedCellRow = {
  cell_latitude: number | string;
  cell_longitude: number | string;
  samples: number;
  drivers: number;
  median_speed_kmh: number | string;
};

/**
 * Creates an RxJS stream that periodically fetches recent rider-measured speeds around the city.
 */
export function createRoadSpeedCellsObservable(
  enabled: boolean,
  refreshMs: number = SPEED_REFRESH_MS,
  fetchCells?: () => Promise<{ data: SpeedCellRow[] | null; error: unknown }>,
): Observable<SpeedCell[]> {
  if (!enabled) return of(EMPTY_CELLS);

  const loader =
    fetchCells ??
    (async () => {
      const { createClient } = await import("@/lib/supabase/client");
      return await createClient().rpc("recent_road_speed_cells", {
        window_minutes: 30,
      });
    });

  return timer(0, refreshMs).pipe(
    switchMap(async () => {
      try {
        const { data, error } = await loader();
        if (error || !data) return EMPTY_CELLS;
        return data.map((row) => ({
          latitude: Number(row.cell_latitude),
          longitude: Number(row.cell_longitude),
          samples: row.samples,
          drivers: row.drivers,
          medianSpeedKmh: Number(row.median_speed_kmh),
        }));
      } catch {
        return EMPTY_CELLS;
      }
    }),
    catchError(() => of(EMPTY_CELLS)),
    shareReplay({ bufferSize: 1, refCount: true }),
  );
}

/**
 * Recent rider-measured speeds around the city, refreshed while `enabled`.
 * Empty when the table, function or session is not available, because
 * telemetry only ever refines a route.
 * Powered by an RxJS polling stream and React 19's useSyncExternalStore.
 */
export function useRoadSpeedCells(enabled: boolean): SpeedCell[] {
  const cells$ = useMemo(
    () => createRoadSpeedCellsObservable(enabled),
    [enabled],
  );
  return useObservable(cells$, EMPTY_CELLS);
}

/**
 * Sends new rider notes to the analysis engine while a manager has the
 * workspace open, then reloads so the verdicts reach routing and the review
 * list. Each set of notes is tried once per page load, so a failing model
 * cannot turn into a request loop.
 */
export function useRoadNoteAnalysis(
  enabled: boolean,
  reports: readonly RoadReport[],
  refresh: () => Promise<unknown>,
) {
  const tried = useRef(new Set<string>());
  const waiting = reports
    .filter(
      (report) =>
        report.status !== "rejected" &&
        !report.decision &&
        Date.parse(report.expires_at) > Date.now(),
    )
    .map((report) => report.id)
    .sort();
  const key = waiting.join(",");

  useEffect(() => {
    if (!enabled || !key || tried.current.has(key)) return;
    tried.current.add(key);
    const controller = new AbortController();
    fetch("/api/road-intel/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal: controller.signal,
    })
      .then((response) => (response.ok ? refresh() : undefined))
      .catch(() => undefined);
    return () => controller.abort();
  }, [enabled, key, refresh]);
}
