"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Observable, Subject } from "rxjs";
import { debounceTime, distinctUntilChanged, switchMap } from "rxjs/operators";

import type { MapPoint } from "@/lib/delivery/map-projection";
import { fetchRoadRoute, hasMapbox } from "@/lib/delivery/mapbox";

const keyOf = (a: MapPoint, b: MapPoint) =>
  `${a.latitude.toFixed(5)},${a.longitude.toFixed(5)};${b.latitude.toFixed(5)},${b.longitude.toFixed(5)}`;

/**
 * Distances already looked up. Each pickup step is its own page, so without
 * this the price would drop back to the straight-line guess on every step.
 */
const known = new Map<string, number>();
const STORAGE_PREFIX = "oern.road-km.";

function remembered(key: string): number | null {
  const cached = known.get(key);
  if (cached !== undefined) return cached;
  try {
    const stored = window.sessionStorage.getItem(STORAGE_PREFIX + key);
    const km = stored === null ? Number.NaN : Number(stored);
    if (Number.isFinite(km)) {
      known.set(key, km);
      return km;
    }
  } catch {
    // Storage can be blocked; the lookup then simply repeats.
  }
  return null;
}

function remember(key: string, km: number) {
  known.set(key, km);
  try {
    window.sessionStorage.setItem(STORAGE_PREFIX + key, String(km));
  } catch {
    // Not stored; the in-memory copy still serves this page.
  }
}

export type RoadDistanceRequest = {
  from: MapPoint;
  to: MapPoint;
  key: string;
};

/**
 * Creates an RxJS stream pipeline that debounces, deduplicates, and cancels
 * outdated road distance requests using switchMap.
 */
export function createRoadDistancePipeline(debounceMs = 400) {
  const request$ = new Subject<RoadDistanceRequest>();

  const result$ = request$.pipe(
    distinctUntilChanged((prev, curr) => prev.key === curr.key),
    debounceTime(debounceMs),
    switchMap(
      (req) =>
        new Observable<{ key: string; km: number } | null>((subscriber) => {
          const controller = new AbortController();
          fetchRoadRoute([req.from, req.to], undefined, controller.signal)
            .then((route) => {
              if (route && Number.isFinite(route.distanceKm)) {
                subscriber.next({ key: req.key, km: route.distanceKm });
              } else {
                subscriber.next(null);
              }
              subscriber.complete();
            })
            .catch(() => {
              subscriber.next(null);
              subscriber.complete();
            });

          return () => {
            controller.abort();
          };
        }),
    ),
  );

  return { request$, result$ };
}

/**
 * Driving distance between two pins from Mapbox, or null until it is known or
 * when there is no road route. The fee falls back to a straight-line estimate
 * meanwhile, so a slow or failed lookup never blocks the price.
 * Powered by an RxJS debounced stream pipeline.
 */
export function useRoadDistance(
  from: MapPoint | null,
  to: MapPoint | null,
): number | null {
  const key = from && to ? keyOf(from, to) : null;
  const [fetched, setFetched] = useState<{ key: string; km: number } | null>(
    null,
  );

  const pipelineRef = useRef<ReturnType<typeof createRoadDistancePipeline> | null>(
    null,
  );
  if (!pipelineRef.current) {
    pipelineRef.current = createRoadDistancePipeline(400);
  }

  useEffect(() => {
    const pipeline = pipelineRef.current;
    if (!pipeline) return;

    const sub = pipeline.result$.subscribe((result) => {
      if (result) {
        remember(result.key, result.km);
        setFetched(result);
      }
    });

    return () => sub.unsubscribe();
  }, []);

  useEffect(() => {
    if (!from || !to || !key || !hasMapbox || remembered(key) !== null) return;
    pipelineRef.current?.request$.next({ from, to, key });
  }, [from, to, key]);

  if (!key) return null;
  if (fetched?.key === key) return fetched.km;
  // Read in render so a page that remounts shows the known price at once.
  return typeof window === "undefined" ? null : remembered(key);
}
