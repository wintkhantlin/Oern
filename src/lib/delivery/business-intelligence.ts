import type { DeliveryOrder, StatusEvent } from "./types.ts";

export type BusinessIntelligence = {
  score: number | null;
  scoreLabel: "Strong" | "Stable" | "Needs attention" | "No data";
  completionRate: number | null;
  onTimeRate: number | null;
  revenueRealizationRate: number | null;
  cashControlRate: number | null;
  earnedRevenue: number;
  revenueAtRisk: number;
  averageRevenuePerDelivery: number | null;
  closedOrders: number;
  deliveredOrders: number;
  recommendations: BusinessRecommendation[];
};

export type BusinessRecommendation = {
  id: "reliability" | "on-time" | "revenue" | "cash" | "growth";
  priority: "high" | "medium" | "positive";
  title: string;
  detail: string;
  href: string;
  action: string;
};

const CLOSED_STATUSES = new Set(["delivered", "failed", "cancelled"]);

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : null;
}

function clampRate(value: number) {
  return Math.min(1, Math.max(0, value));
}

function orderNetFee(order: DeliveryOrder) {
  return Math.max(
    0,
    (order.delivery_fee ?? 0) -
      (order.discount_amount ?? 0) -
      (order.refunded_amount ?? 0),
  );
}

function percentage(value: number | null) {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}

/**
 * Turns the operational ledger into a small set of decision metrics.
 *
 * Alignment score = 45% service reliability + 35% revenue realization
 * + 20% cash control. Service reliability itself is 55% successful closure
 * and 45% on-time delivery. Missing inputs are omitted and the remaining
 * weights are rebalanced, so absent legacy data is never treated as failure.
 */
export function calculateBusinessIntelligence(
  orders: DeliveryOrder[],
  statusEvents: StatusEvent[] = [],
): BusinessIntelligence {
  const closed = orders.filter((order) => CLOSED_STATUSES.has(order.status));
  const delivered = closed.filter((order) => order.status === "delivered");
  const completionRate = ratio(delivered.length, closed.length);

  const deliveredAt = new Map<string, number>();
  for (const event of statusEvents) {
    if (event.status !== "delivered") continue;
    const stamp = Date.parse(event.created_at);
    if (!Number.isFinite(stamp)) continue;
    const current = deliveredAt.get(event.order_id);
    if (current == null || stamp < current)
      deliveredAt.set(event.order_id, stamp);
  }

  let timedDeliveries = 0;
  let onTimeDeliveries = 0;
  for (const order of delivered) {
    const deadline = order.estimated_delivery_at
      ? Date.parse(order.estimated_delivery_at)
      : Number.NaN;
    const completion = deliveredAt.get(order.id);
    if (!Number.isFinite(deadline) || completion == null) continue;
    timedDeliveries += 1;
    if (completion <= deadline) onTimeDeliveries += 1;
  }
  const onTimeRate = ratio(onTimeDeliveries, timedDeliveries);

  let earnedRevenue = 0;
  let closedRevenueOpportunity = 0;
  for (const order of closed) {
    const fee = orderNetFee(order);
    closedRevenueOpportunity += fee;
    if (order.status === "delivered") earnedRevenue += fee;
  }
  const revenueRealizationRate = ratio(earnedRevenue, closedRevenueOpportunity);
  const revenueAtRisk = Math.max(0, closedRevenueOpportunity - earnedRevenue);
  const averageRevenuePerDelivery = ratio(earnedRevenue, delivered.length);

  let controlledCash = 0;
  let accountableCash = 0;
  for (const order of orders) {
    if (order.cod_amount <= 0) continue;
    if (order.cod_status === "collected" || order.cod_status === "settled") {
      accountableCash += order.cod_amount;
      if (order.cod_status === "settled") controlledCash += order.cod_amount;
    }
  }
  const cashControlRate = ratio(controlledCash, accountableCash);

  const serviceParts: Array<[number | null, number]> = [
    [completionRate, 0.55],
    [onTimeRate, 0.45],
  ];
  const serviceWeight = serviceParts.reduce(
    (sum, [value, weight]) => sum + (value == null ? 0 : weight),
    0,
  );
  const serviceReliability = serviceWeight
    ? serviceParts.reduce(
        (sum, [value, weight]) =>
          sum + (value == null ? 0 : clampRate(value) * weight),
        0,
      ) / serviceWeight
    : null;

  const scoreParts: Array<[number | null, number]> = [
    [serviceReliability, 0.45],
    [revenueRealizationRate, 0.35],
    [cashControlRate, 0.2],
  ];
  const availableWeight = scoreParts.reduce(
    (sum, [value, weight]) => sum + (value == null ? 0 : weight),
    0,
  );
  const score = availableWeight
    ? Math.round(
        (scoreParts.reduce(
          (sum, [value, weight]) =>
            sum + (value == null ? 0 : clampRate(value) * weight),
          0,
        ) /
          availableWeight) *
          100,
      )
    : null;

  const recommendations: BusinessRecommendation[] = [];
  if (completionRate != null && completionRate < 0.9) {
    recommendations.push({
      id: "reliability",
      priority: completionRate < 0.75 ? "high" : "medium",
      title: "Reduce failed and cancelled deliveries",
      detail: `${percentage(completionRate)} of closed orders were delivered. Review exceptions before adding more volume.`,
      href: "/manager/order",
      action: "Review orders",
    });
  }
  if (onTimeRate != null && onTimeRate < 0.9) {
    recommendations.push({
      id: "on-time",
      priority: onTimeRate < 0.75 ? "high" : "medium",
      title: "Protect delivery promises",
      detail: `${percentage(onTimeRate)} of measurable deliveries met their ETA. Prioritize at-risk routes and assignment speed.`,
      href: "/manager/track",
      action: "Open live tracking",
    });
  }
  if (revenueAtRisk > 0) {
    recommendations.push({
      id: "revenue",
      priority:
        revenueRealizationRate != null && revenueRealizationRate < 0.8
          ? "high"
          : "medium",
      title: "Recover fee revenue at risk",
      detail: `${Math.round(revenueAtRisk).toLocaleString("en-US")} MMK of closed-order fee value was not realized because orders did not complete.`,
      href: "/manager/order",
      action: "Inspect failed orders",
    });
  }
  if (cashControlRate != null && cashControlRate < 1) {
    recommendations.push({
      id: "cash",
      priority: cashControlRate < 0.75 ? "high" : "medium",
      title: "Settle collected cash",
      detail: `${percentage(cashControlRate)} of accountable COD value is settled. Close the rider handover gap first.`,
      href: "/manager/cod",
      action: "Open COD ledger",
    });
  }
  if (recommendations.length === 0 && score != null) {
    recommendations.push({
      id: "growth",
      priority: "positive",
      title: "Operations are ready for measured growth",
      detail:
        "Core reliability, realized revenue, and cash control are aligned. Test growth one pickup area at a time.",
      href: "/manager/order/create",
      action: "Create an order",
    });
  }

  return {
    score,
    scoreLabel:
      score == null
        ? "No data"
        : score >= 85
          ? "Strong"
          : score >= 70
            ? "Stable"
            : "Needs attention",
    completionRate,
    onTimeRate,
    revenueRealizationRate,
    cashControlRate,
    earnedRevenue,
    revenueAtRisk,
    averageRevenuePerDelivery,
    closedOrders: closed.length,
    deliveredOrders: delivered.length,
    recommendations,
  };
}
