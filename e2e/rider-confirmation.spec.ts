import { makeOrder, signInAs } from "./support/supabase-mock";
import { expect, test } from "./support/test";

test("a stop without a map pin can reopen delivery confirmation after closing and reloading", async ({
  page,
  context,
}) => {
  const backend = await signInAs(context, "driver", {
    delivery_orders: [
      makeOrder({
        status: "in_transit",
        delivery_latitude: null,
        delivery_longitude: null,
      }),
    ],
    delivery_assignments: [
      {
        id: "assignment-1",
        order_id: "order-1",
        driver_id: "driver-1",
        vehicle_id: null,
        route_id: null,
        assigned_at: new Date().toISOString(),
        ended_at: null,
      },
    ],
  });
  await page.goto("/rider/route");
  await page
    .getByRole("button", { name: "Confirm arrival", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Back to stop" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to stop" }).click();

  const confirm = page.getByRole("button", {
    name: "Confirm delivery",
    exact: true,
  });
  await expect(confirm).toBeInViewport();
  await page
    .getByRole("button", { name: "Show stop details and full route" })
    .click();
  await expect(confirm).toBeInViewport();
  await page.reload();
  await expect(confirm).toBeInViewport();
  await page.screenshot({
    path: `test-results/rider-confirmation-${test.info().project.name}.png`,
  });
  await confirm.click();
  await expect(
    page.getByRole("button", { name: "Back to stop" }),
  ).toBeVisible();
  // Opening the form must never complete the delivery on its own.
  expect(
    backend.mutations.filter((mutation) => mutation.table === "rpc"),
  ).toHaveLength(0);
});
