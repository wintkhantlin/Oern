import { useEffect, useRef, useState } from "react";
import { Observable, Subject } from "rxjs";
import { switchMap } from "rxjs/operators";
import type { MapPoint } from "./map-projection.ts";
import {
  destinationKeyFor,
  fetchRoadRoute,
  hasMapbox,
  needsRouteRequest,
  type RoadRoute,
  type RoadRouteOptions,
  type RouteRequest,
} from "./mapbox.ts";
import { distanceKm } from "./rider-route.ts";

export type RoutePipelineRequest = {
  origin: MapPoint;
  destinations: MapPoint[];
  destinationKey: string;
  options?: RoadRouteOptions;
};

/**
 * Creates an RxJS stream pipeline that switches to the newest road route request,
 * discarding obsolete in-flight requests.
 */
export function createRoadRoutePipeline(
  fetcher: (
    points: MapPoint[],
    options?: RoadRouteOptions,
  ) => Promise<RoadRoute | null> = fetchRoadRoute,
) {
  const request$ = new Subject<RoutePipelineRequest>();

  const result$ = request$.pipe(
    switchMap(
      (req) =>
        new Observable<{ destinationKey: string; route: RoadRoute | null }>(
          (subscriber) => {
            let active = true;
            fetcher([req.origin, ...req.destinations], req.options)
              .then((route) => {
                if (active) {
                  subscriber.next({ destinationKey: req.destinationKey, route });
                  subscriber.complete();
                }
              })
              .catch(() => {
                if (active) {
                  subscriber.next({
                    destinationKey: req.destinationKey,
                    route: null,
                  });
                  subscriber.complete();
                }
              });

            return () => {
              active = false;
            };
          },
        ),
    ),
  );

  return { request$, result$ };
}

/**
 * Road route from `origin` through `destinations`. Returns null while loading,
 * when Mapbox is not configured, or when no road route exists; callers then
 * keep their straight-line fallback. GPS jitter does not re-request the route
 * until the origin has moved far enough or the cached route has aged out.
 * Powered by an RxJS route pipeline.
 */
export function useRoadRoute(
  origin: MapPoint | null,
  destinations: MapPoint[],
  options?: RoadRouteOptions,
) {
  const latitude = origin?.latitude;
  const longitude = origin?.longitude;
  const destinationKey = destinationKeyFor(destinations);
  const [result, setResult] = useState<{
    destinationKey: string;
    route: RoadRoute | null;
  } | null>(null);
  const last = useRef<RouteRequest | null>(null);

  const pipelineRef = useRef<ReturnType<typeof createRoadRoutePipeline> | null>(
    null,
  );
  if (!pipelineRef.current) {
    pipelineRef.current = createRoadRoutePipeline();
  }

  useEffect(() => {
    const pipeline = pipelineRef.current;
    if (!pipeline) return;

    const sub = pipeline.result$.subscribe((res) => {
      setResult(res);
    });

    return () => sub.unsubscribe();
  }, []);

  useEffect(() => {
    if (!hasMapbox || latitude == null || longitude == null || !destinationKey)
      return;
    const from = { latitude, longitude };
    const now = Date.now();
    const movedKm = last.current
      ? distanceKm(last.current.origin, from)
      : Number.POSITIVE_INFINITY;
    if (!needsRouteRequest(last.current, destinationKey, movedKm, now)) return;

    last.current = { destinationKey, origin: from, at: now };
    pipelineRef.current?.request$.next({
      origin: from,
      destinations,
      destinationKey,
      options,
    });
  }, [latitude, longitude, destinationKey, destinations, options]);

  return result?.destinationKey === destinationKey ? result.route : null;
}
