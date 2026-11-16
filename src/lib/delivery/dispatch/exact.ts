import { evaluateRoute } from "./route-eval.ts";
import type { Instance, Matrix, Stop } from "./types.ts";

/*
 * Exhaustive optimum for tiny instances, used to check the heuristic against
 * the truth. It enumerates every precedence-respecting stop order for every
 * subset of orders on every truck, scores each with the same evaluator the
 * solver uses, then combines trucks with a subset DP:
 *
 *   f_k(S) = min over T ⊆ S of  best_k(T) + f_{k-1}(S \ T)
 *
 * and finally  min over S of  f_K(S) + unservedPenalty × (n − |S|).
 *
 * Cost grows factorially, so it refuses more than MAX_EXACT_ORDERS.
 */

export const MAX_EXACT_ORDERS = 5;

export type ExactResult = { optimum: number; served: number };

function bestForSubset(
  inst: Instance,
  matrix: Matrix,
  truckIndex: number,
  orders: number[],
): number {
  const truck = inst.trucks[truckIndex];
  const stops: Stop[] = [];
  const doorOrders = orders.filter((r) => inst.requests[r].origin === "door");
  const depotOrders = orders.filter((r) => inst.requests[r].origin === "depot");
  const total = doorOrders.length * 2 + depotOrders.length;
  let best = Number.POSITIVE_INFINITY;
  const picked = new Set<number>();
  const delivered = new Set<number>();

  const dfs = () => {
    if (stops.length === total) {
      const result = evaluateRoute(inst, matrix, truck, stops);
      if (result.feasible && result.score < best) best = result.score;
      return;
    }
    for (const r of orders) {
      const door = inst.requests[r].origin === "door";
      if (door && !picked.has(r)) {
        picked.add(r);
        stops.push({ r, kind: "P" });
        dfs();
        stops.pop();
        picked.delete(r);
      } else if (!delivered.has(r) && (!door || picked.has(r))) {
        delivered.add(r);
        stops.push({ r, kind: "D" });
        dfs();
        stops.pop();
        delivered.delete(r);
      }
    }
  };
  dfs();
  return best;
}

export function exactOptimum(inst: Instance, matrix: Matrix): ExactResult {
  const n = inst.requests.length;
  if (n > MAX_EXACT_ORDERS)
    throw new Error(`Exact search supports at most ${MAX_EXACT_ORDERS} orders`);
  const full = (1 << n) - 1;
  const members = (mask: number) =>
    Array.from({ length: n }, (_, r) => r).filter((r) => mask & (1 << r));

  // f[mask] = cheapest way for the trucks so far to serve exactly `mask`.
  let f = new Array<number>(full + 1).fill(Number.POSITIVE_INFINITY);
  f[0] = 0;
  for (let k = 0; k < inst.trucks.length; k++) {
    const best = new Array<number>(full + 1);
    best[0] = 0;
    for (let mask = 1; mask <= full; mask++)
      best[mask] = bestForSubset(inst, matrix, k, members(mask));
    const next = new Array<number>(full + 1).fill(Number.POSITIVE_INFINITY);
    for (let mask = 0; mask <= full; mask++) {
      for (let sub = mask; ; sub = (sub - 1) & mask) {
        const value = best[sub] + f[mask ^ sub];
        if (value < next[mask]) next[mask] = value;
        if (sub === 0) break;
      }
    }
    f = next;
  }

  let optimum = Number.POSITIVE_INFINITY;
  let served = 0;
  const popcount = (m: number) => members(m).length;
  for (let mask = 0; mask <= full; mask++) {
    const value = f[mask] + (n - popcount(mask)) * inst.params.unservedPenalty;
    if (value < optimum) {
      optimum = value;
      served = popcount(mask);
    }
  }
  return { optimum, served };
}
