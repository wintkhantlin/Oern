import { useEffect, useMemo, useState } from "react";
import { Observable } from "rxjs";
import type { GpsState } from "@/components/delivery/rider-active";
import { sendDriverLocation } from "@/lib/delivery/actions";
import type { DeliveryStop } from "@/lib/delivery/driver-route";
import { isLocalOrderId } from "@/lib/delivery/jobs";
import {
  type DevicePosition,
  STALE_AFTER_MS,
} from "@/lib/delivery/rider-helpers";
import { watchRiderLocations } from "@/lib/delivery/rider-location";
import { PREVIEW_DEPOT } from "@/lib/delivery/rider-preview";
import { distanceKm, type GeoPoint } from "@/lib/delivery/rider-route";
import { usePermissionRecovery } from "@/lib/delivery/use-permission-recovery";
import { createClient } from "@/lib/supabase/client";

export type GpsStreamEvent =
  | { type: "position"; position: DevicePosition }
  | { type: "state"; state: GpsState };

export function createDeviceGpsObservable(
  wantsGps: boolean,
  geolocation: Geolocation | null,
): Observable<GpsStreamEvent> {
  return new Observable<GpsStreamEvent>((subscriber) => {
    if (!wantsGps) {
      subscriber.next({ type: "state", state: "off" });
      subscriber.complete();
      return;
    }
    if (!geolocation) {
      subscriber.next({ type: "state", state: "unavailable" });
      subscriber.complete();
      return;
    }
    subscriber.next({ type: "state", state: "waiting" });
    const id = geolocation.watchPosition(
      (fix) => {
        subscriber.next({
          type: "position",
          position: {
            latitude: fix.coords.latitude,
            longitude: fix.coords.longitude,
            heading:
              fix.coords.heading != null && Number.isFinite(fix.coords.heading)
                ? fix.coords.heading
                : null,
            speedKmh:
              fix.coords.speed != null && Number.isFinite(fix.coords.speed)
                ? Math.max(0, Math.round(fix.coords.speed * 3.6))
                : null,
            accuracy: fix.coords.accuracy ?? null,
            at: fix.timestamp || Date.now(),
          },
        });
        subscriber.next({ type: "state", state: "live" });
      },
      (error) => {
        subscriber.next({
          type: "state",
          state:
            error.code === error.PERMISSION_DENIED ? "denied" : "unavailable",
        });
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    );

    return () => {
      geolocation.clearWatch(id);
    };
  });
}

export type RiderLocationOptions = {
  wantsGps: boolean;
  isPreview: boolean;
  previewGpsDenied: boolean;
  canUseLiveData: boolean;
  driverId: string | null;
  onBoardOrderIds: string[];
  routeState: string;
  stop: DeliveryStop | null;
  routeStops: DeliveryStop[];
  now: number;
};

export function useRiderLocation({
  wantsGps,
  isPreview,
  previewGpsDenied,
  canUseLiveData,
  driverId,
  onBoardOrderIds,
  routeState,
  stop,
  routeStops,
  now,
}: RiderLocationOptions) {
  const [position, setPosition] = useState<DevicePosition | null>(null);
  const [gps, setGps] = useState<GpsState>("off");
  const [gpsAttempt, setGpsAttempt] = useState(0);

  useEffect(() => {
    void gpsAttempt;
    const geo =
      typeof navigator !== "undefined" && "geolocation" in navigator
        ? navigator.geolocation
        : null;
    const gps$ = createDeviceGpsObservable(wantsGps, geo);
    const subscription = gps$.subscribe({
      next: (event) => {
        if (event.type === "position") {
          setPosition(event.position);
        } else {
          setGps((state) =>
            event.state === "waiting" && state === "live" ? state : event.state,
          );
        }
      },
    });
    return () => subscription.unsubscribe();
  }, [wantsGps, gpsAttempt]);

  // Auto-recover when location permission is granted in browser settings
  usePermissionRecovery({
    permission: "geolocation",
    enabled: wantsGps,
    onGranted: () => {
      setGpsAttempt((attempt) => attempt + 1);
    },
    onDenied: () => {
      setGps("denied");
    },
  });

  // In preview the truck sits 600 m short of the current stop, or at the depot.
  const previewPoint = useMemo<GeoPoint | null>(() => {
    if (!isPreview || previewGpsDenied) return null;
    if (!stop?.point) return PREVIEW_DEPOT;
    const index = routeStops.indexOf(stop);
    const from =
      routeStops
        .slice(0, index)
        .reverse()
        .find((item) => item.point)?.point ?? PREVIEW_DEPOT;
    if (stop.state === "ARRIVED" || stop.state === "HANDOVER_IN_PROGRESS")
      return stop.point;
    const total = distanceKm(from, stop.point);
    const t = total > 0.6 ? 1 - 0.6 / total : 0;
    return {
      latitude: from.latitude + (stop.point.latitude - from.latitude) * t,
      longitude: from.longitude + (stop.point.longitude - from.longitude) * t,
    };
  }, [isPreview, previewGpsDenied, stop, routeStops]);

  const gpsState: GpsState = isPreview
    ? previewGpsDenied
      ? "denied"
      : "live"
    : gps === "live" && position && now - position.at > STALE_AFTER_MS
      ? "stale"
      : gps;

  // A stale fix is still shown, labelled as old; a denied one never is.
  const riderPoint: GeoPoint | null = isPreview
    ? previewPoint
    : gpsState === "live" || gpsState === "stale"
      ? position
      : null;

  // Share location for every parcel on board, as customer tracking requires.
  const onBoardKey = JSON.stringify(onBoardOrderIds.slice().sort());
  const [, setSharing] = useState<number | null>(null);

  useEffect(() => {
    void gpsAttempt;
    const orderIds = JSON.parse(onBoardKey) as string[];
    if (
      isPreview ||
      !canUseLiveData ||
      !driverId ||
      !orderIds.length ||
      routeState === "PAUSED" ||
      !("geolocation" in navigator)
    ) {
      setSharing(null);
      return;
    }
    return watchRiderLocations({
      geolocation: navigator.geolocation,
      orderIds,
      send: async (orderId, point) => {
        if (isLocalOrderId(orderId)) return;
        await sendDriverLocation(
          createClient(),
          orderId,
          driverId,
          point.latitude,
          point.longitude,
          point.accuracy,
          { speedMps: point.speedMps, headingDegrees: point.headingDegrees },
        );
      },
      onSent: (sentIds) => setSharing(sentIds.length),
      onError: (_msg, permissionDenied) => {
        setSharing(null);
        if (permissionDenied) setGps("denied");
      },
    });
  }, [onBoardKey, isPreview, canUseLiveData, driverId, routeState, gpsAttempt]);

  const retryGps = () => setGpsAttempt((value) => value + 1);

  return {
    position,
    gpsState,
    riderPoint,
    retryGps,
  };
}
