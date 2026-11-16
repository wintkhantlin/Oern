import { Observable } from "rxjs";

export type RiderLocationPoint = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  /** Ground speed from the device, when it reports one. */
  speedMps: number | null;
  /** Direction of travel in degrees clockwise from north, when known. */
  headingDegrees: number | null;
  recordedAt: string;
};

const finiteOrNull = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export type LocationWatchOptions = {
  geolocation: Pick<Geolocation, "watchPosition" | "clearWatch">;
  orderIds: string[];
  send: (orderId: string, point: RiderLocationPoint) => Promise<void>;
  onSent: (orderIds: string[], point: RiderLocationPoint) => void;
  onError: (message: string, permissionDenied: boolean) => void;
  now?: () => number;
};

/**
 * Creates an RxJS observable wrapping Geolocation.watchPosition.
 */
export function createGeolocationObservable(
  geolocation: Pick<Geolocation, "watchPosition" | "clearWatch">,
  options?: PositionOptions,
): Observable<GeolocationPosition> {
  return new Observable<GeolocationPosition>((subscriber) => {
    const watchId = geolocation.watchPosition(
      (pos) => subscriber.next(pos),
      (err) => subscriber.error(err),
      options,
    );
    return () => {
      geolocation.clearWatch(watchId);
    };
  });
}

/**
 * Creates an RxJS Observable stream for broadcasting rider positions to active orders.
 */
export function createRiderLocationObservable({
  geolocation,
  orderIds,
  send,
  now = Date.now,
}: Omit<LocationWatchOptions, "onSent" | "onError">): Observable<{
  sent: string[];
  point: RiderLocationPoint;
  error?: { message: string; permissionDenied: boolean };
}> {
  return new Observable((subscriber) => {
    let active = true;
    let sending = false;
    let lastSentAt = Number.NEGATIVE_INFINITY;
    const targets = [...new Set(orderIds)];
    if (!targets.length) {
      subscriber.complete();
      return;
    }

    const watchId = geolocation.watchPosition(
      async (position) => {
        if (!active || sending) return;
        const timestamp = now();
        if (timestamp - lastSentAt < 10_000) return;
        const { latitude, longitude, accuracy, speed, heading } =
          position.coords;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
        lastSentAt = timestamp;
        sending = true;
        try {
          const point: RiderLocationPoint = {
            latitude,
            longitude,
            accuracy: Number.isFinite(accuracy) ? accuracy : null,
            speedMps:
              finiteOrNull(speed) == null ? null : Math.max(0, speed ?? 0),
            headingDegrees: finiteOrNull(heading),
            recordedAt: new Date(timestamp).toISOString(),
          };
          const results = await Promise.allSettled(
            targets.map(async (orderId) => send(orderId, point)),
          );
          if (!active) return;
          const sent = targets.filter(
            (_, index) => results[index].status === "fulfilled",
          );
          const failure = results.find((result) => result.status === "rejected");
          subscriber.next({
            sent,
            point,
            ...(failure && failure.status === "rejected"
              ? {
                  error: {
                    message:
                      failure.reason instanceof Error
                        ? failure.reason.message
                        : "Could not update every parcel location. Keep this app open to retry.",
                    permissionDenied: false,
                  },
                }
              : {}),
          });
        } finally {
          sending = false;
        }
      },
      (cause) => {
        if (!active) return;
        const permissionDenied = cause?.code === cause?.PERMISSION_DENIED;
        subscriber.next({
          sent: [],
          point: {
            latitude: Number.NaN,
            longitude: Number.NaN,
            accuracy: null,
            speedMps: null,
            headingDegrees: null,
            recordedAt: new Date(now()).toISOString(),
          },
          error: {
            message: permissionDenied
              ? "Location permission is off. Enable it in your browser settings, then share your location."
              : "GPS could not find your location. Keep this app open while GPS retries.",
            permissionDenied,
          },
        });
      },
      { enableHighAccuracy: true, maximumAge: 4_000, timeout: 20_000 },
    );

    return () => {
      active = false;
      geolocation.clearWatch(watchId);
    };
  });
}

/** One GPS watch updates every parcel on board, independently of the open task. */
export function watchRiderLocations(options: LocationWatchOptions) {
  const { onSent, onError } = options;
  const targets = [...new Set(options.orderIds)];
  if (!targets.length) return () => {};

  const stream$ = createRiderLocationObservable(options);
  const subscription = stream$.subscribe({
    next: (event) => {
      if (event.sent.length) {
        onSent(event.sent, event.point);
      }
      if (event.error) {
        onError(event.error.message, event.error.permissionDenied);
      }
    },
  });

  return () => {
    subscription.unsubscribe();
  };
}
