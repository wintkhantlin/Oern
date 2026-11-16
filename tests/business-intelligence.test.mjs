import assert from "node:assert/strict";
import test from "node:test";

import { calculateBusinessIntelligence } from "../src/lib/delivery/business-intelligence.ts";

function order(overrides = {}) {
  return {
    id: "order-1",
    status: "delivered",
    delivery_fee: 3000,
    discount_amount: 0,
    refunded_amount: 0,
    cod_amount: 0,
    cod_status: "not_required",
    estimated_delivery_at: null,
    ...overrides,
  };
}

test("business score combines service, revenue, and cash controls", () => {
  const result = calculateBusinessIntelligence(
    [
      order({ id: "done", cod_amount: 10_000, cod_status: "settled" }),
      order({ id: "failed", status: "failed", delivery_fee: 2000 }),
      order({
        id: "cash",
        status: "in_transit",
        cod_amount: 5000,
        cod_status: "collected",
      }),
    ],
    [],
  );

  assert.equal(result.completionRate, 0.5);
  assert.equal(result.revenueRealizationRate, 0.6);
  assert.equal(result.cashControlRate, 2 / 3);
  assert.equal(result.earnedRevenue, 3000);
  assert.equal(result.revenueAtRisk, 2000);
  assert.equal(result.score, 57);
  assert.equal(result.scoreLabel, "Needs attention");
  assert.deepEqual(
    result.recommendations.map((item) => item.id),
    ["reliability", "revenue", "cash"],
  );
});

test("on-time delivery uses delivery status events and ignores missing ETA data", () => {
  const result = calculateBusinessIntelligence(
    [
      order({ id: "early", estimated_delivery_at: "2026-11-16T10:00:00Z" }),
      order({ id: "late", estimated_delivery_at: "2026-11-16T10:00:00Z" }),
      order({ id: "legacy" }),
    ],
    [
      {
        id: 1,
        order_id: "early",
        status: "delivered",
        created_at: "2026-11-16T09:50:00Z",
      },
      {
        id: 2,
        order_id: "late",
        status: "delivered",
        created_at: "2026-11-16T10:20:00Z",
      },
      {
        id: 3,
        order_id: "legacy",
        status: "delivered",
        created_at: "2026-11-16T09:00:00Z",
      },
    ],
  );

  assert.equal(result.onTimeRate, 0.5);
  assert.equal(result.completionRate, 1);
});

test("missing legacy inputs are excluded instead of scored as failures", () => {
  const result = calculateBusinessIntelligence([order({ delivery_fee: null })]);

  assert.equal(result.score, 100);
  assert.equal(result.revenueRealizationRate, null);
  assert.equal(result.cashControlRate, null);
  assert.equal(result.scoreLabel, "Strong");
});

test("an empty ledger reports no score", () => {
  const result = calculateBusinessIntelligence([]);

  assert.equal(result.score, null);
  assert.equal(result.scoreLabel, "No data");
  assert.deepEqual(result.recommendations, []);
});
