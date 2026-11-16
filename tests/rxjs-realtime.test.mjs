import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspaceRealtimeObservable } from "../src/lib/delivery/workspace-realtime.ts";

test("createWorkspaceRealtimeObservable streams actions and handles unsubscribe teardown", () => {
  const handlers = new Map();
  let removed = false;
  let connection;

  const mockSupabase = {
    channel: (name) => ({
      name,
      on(_type, config, callback) {
        handlers.set(config.table, { config, callback });
        return this;
      },
      subscribe(callback) {
        connection = callback;
        return this;
      },
    }),
    removeChannel: async () => {
      removed = true;
    },
  };

  const actions = [];
  const observable$ = createWorkspaceRealtimeObservable(mockSupabase, {
    userId: "driver-123",
    role: "driver",
  });

  const subscription = observable$.subscribe((action) => {
    actions.push(action);
  });

  // Test subscribed event
  connection("SUBSCRIBED");
  assert.equal(actions.length, 1);
  assert.deepEqual(actions[0], { type: "refresh", reason: "subscribed" });

  // Test location event
  handlers.get("delivery_locations").callback({
    new: {
      order_id: "order-1",
      latitude: 16.8,
      longitude: 96.15,
      recorded_at: "2026-11-16T12:00:00Z",
    },
  });
  assert.equal(actions.length, 2);
  assert.equal(actions[1].type, "location");
  assert.equal(actions[1].location.order_id, "order-1");

  // Test teardown on unsubscribe
  subscription.unsubscribe();
  assert.equal(removed, true);
});

import { createSimulatedFleetObservable } from "../src/lib/delivery/simulated-fleet.ts";
import { firstValueFrom } from "rxjs";

test("createSimulatedFleetObservable emits orders when enabled and empty when disabled", async () => {
  const disabledFleet = await firstValueFrom(
    createSimulatedFleetObservable(false),
  );
  assert.deepEqual(disabledFleet, []);

  const enabledFleet = await firstValueFrom(
    createSimulatedFleetObservable(true, 1000),
  );
  assert.equal(enabledFleet.length > 0, true);
  assert.equal(enabledFleet[0].status, "in_transit");
  assert.equal(enabledFleet[0].customer_name, "Simulated delivery");
  assert.equal(typeof enabledFleet[0].latest_location.latitude, "number");
});

import { createRoadRoutePipeline } from "../src/lib/delivery/use-road-route.ts";

test("createRoadRoutePipeline handles requests and emits routed results", async () => {
  const mockRoute = { distanceKm: 4.2, durationMinutes: 12, coordinates: [] };
  const mockFetcher = async () => mockRoute;

  const pipeline = createRoadRoutePipeline(mockFetcher);
  const results = [];
  const sub = pipeline.result$.subscribe((res) => results.push(res));

  pipeline.request$.next({
    origin: { latitude: 16.8, longitude: 96.15 },
    destinations: [{ latitude: 16.82, longitude: 96.16 }],
    destinationKey: "dest-1",
  });

  // Wait for microtask / async promise to resolve
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(results.length, 1);
  assert.equal(results[0].destinationKey, "dest-1");
  assert.equal(results[0].route.distanceKm, 4.2);

  sub.unsubscribe();
});

import { createRoadSpeedCellsObservable } from "../src/lib/delivery/road-intel/use-road-intel.ts";

test("createRoadSpeedCellsObservable streams parsed speed cells and handles error fallbacks", async () => {
  const disabled = await firstValueFrom(createRoadSpeedCellsObservable(false));
  assert.deepEqual(disabled, []);

  const mockFetch = async () => ({
    data: [
      {
        cell_latitude: "16.85",
        cell_longitude: "96.12",
        samples: 14,
        drivers: 3,
        median_speed_kmh: "24.5",
      },
    ],
    error: null,
  });

  const cells = await firstValueFrom(
    createRoadSpeedCellsObservable(true, 10000, mockFetch),
  );
  assert.equal(cells.length, 1);
  assert.equal(cells[0].latitude, 16.85);
  assert.equal(cells[0].longitude, 96.12);
  assert.equal(cells[0].medianSpeedKmh, 24.5);
});
