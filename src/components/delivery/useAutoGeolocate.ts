import { useEffect, useRef, useState } from "react";
import { Observable, Subject } from "rxjs";
import { switchMap } from "rxjs/operators";
import type { MapPoint } from "@/lib/delivery/map-projection";
import { reverseGeocode } from "@/lib/delivery/mapbox";

export type GeolocateState =
  | "idle"
  | "locating"
  | "ready"
  | "denied"
  | "unavailable"
  | "error";

export type GeolocateResult = {
  point: MapPoint | null;
  address: string | null;
  accuracy: number | null;
  state: GeolocateState;
  error: string | null;
  retry: () => void;
};

export type GeolocateStreamEvent = {
  point: MapPoint | null;
  address: string | null;
  accuracy: number | null;
  state: GeolocateState;
  error: string | null;
};

/**
 * Creates an RxJS stream that geolocates the user and fetches the reverse geocoded address.
 */
export function createGeolocateObservable(
  enabled: boolean,
  highAccuracy: boolean,
): Observable<GeolocateStreamEvent> {
  return new Observable<GeolocateStreamEvent>((subscriber) => {
    if (!enabled) {
      subscriber.next({
        point: null,
        address: null,
        accuracy: null,
        state: "unavailable",
        error: null,
      });
      subscriber.complete();
      return;
    }

    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      subscriber.next({
        point: null,
        address: null,
        accuracy: null,
        state: "unavailable",
        error: "Geolocation is not available in your browser",
      });
      subscriber.complete();
      return;
    }

    subscriber.next({
      point: null,
      address: null,
      accuracy: null,
      state: "locating",
      error: null,
    });

    let active = true;

    const requestPosition = (useHighAcc: boolean) => {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          if (!active) return;
          try {
            const here: MapPoint = {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            };
            const acc = Math.round(position.coords.accuracy);

            // Emit ready with point and accuracy
            subscriber.next({
              point: here,
              address: null,
              accuracy: acc,
              state: "ready",
              error: null,
            });

            // Try reverse geocoding
            try {
              const name = await reverseGeocode(here);
              if (active && name) {
                subscriber.next({
                  point: here,
                  address: name,
                  accuracy: acc,
                  state: "ready",
                  error: null,
                });
              }
            } catch (err) {
              console.warn("Reverse geocoding failed:", err);
            }
            subscriber.complete();
          } catch (err) {
            if (!active) return;
            subscriber.next({
              point: null,
              address: null,
              accuracy: null,
              state: "error",
              error: "Failed to process location data",
            });
            console.error("Geolocate error:", err);
            subscriber.complete();
          }
        },
        (geoError) => {
          if (!active) return;
          let state: GeolocateState = "error";
          let error =
            "Unable to get your location. Please try again or type an address.";

          if (geoError.code === geoError.PERMISSION_DENIED) {
            state = "denied";
            error =
              "Location permission denied. Please enable it in your browser settings.";
          } else if (geoError.code === geoError.TIMEOUT) {
            state = "error";
            error = "Location request timed out. Please try again.";
          } else if (geoError.code === geoError.POSITION_UNAVAILABLE) {
            state = "unavailable";
            error = "Location is unavailable. Please try again.";
          }

          // Retry with lower accuracy if high accuracy fails
          if (useHighAcc && geoError.code !== geoError.PERMISSION_DENIED) {
            requestPosition(false);
            return;
          }

          subscriber.next({
            point: null,
            address: null,
            accuracy: null,
            state,
            error,
          });
          subscriber.complete();
        },
        {
          enableHighAccuracy: useHighAcc,
          timeout: 10_000,
          maximumAge: 30_000,
        },
      );
    };

    requestPosition(highAccuracy);

    return () => {
      active = false;
    };
  });
}

/**
 * Hook that automatically geolocates the user on mount and reverse geocodes
 * the location to get a human-readable address. Powered by RxJS.
 */
export function useAutoGeolocate(
  enabled: boolean = true,
  highAccuracy: boolean = true,
): GeolocateResult {
  const [point, setPoint] = useState<MapPoint | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [state, setState] = useState<GeolocateState>("idle");
  const [error, setError] = useState<string | null>(null);

  const triggerSubjectRef = useRef(new Subject<boolean>());

  useEffect(() => {
    const trigger$ = triggerSubjectRef.current;
    const subscription = trigger$
      .pipe(switchMap((highAcc) => createGeolocateObservable(enabled, highAcc)))
      .subscribe({
        next: (event) => {
          setState(event.state);
          if (event.point !== null) setPoint(event.point);
          if (event.address !== null) setAddress(event.address);
          if (event.accuracy !== null) setAccuracy(event.accuracy);
          if (event.error !== null) setError(event.error);
        },
      });

    if (enabled && state === "idle") {
      trigger$.next(highAccuracy);
    }

    return () => subscription.unsubscribe();
  }, [enabled, highAccuracy, state]);

  const retry = () => {
    setPoint(null);
    setAddress(null);
    setAccuracy(null);
    setState("idle");
    setError(null);
    triggerSubjectRef.current.next(highAccuracy);
  };

  return {
    point,
    address,
    accuracy,
    state,
    error,
    retry,
  };
}
