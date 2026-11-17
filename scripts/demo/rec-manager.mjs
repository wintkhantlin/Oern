import { open } from "./rec-lib.mjs";
// Manager desktop take. Cursor motion comes from mouse-model.mjs (see MOUSE_MOVEMENT.md).
const r = await open("manager", { mobile: false, name: "manager-v2" });
const { page, mark, press, hover, scroll, glide, drag, wait } = r;
const nav = (label) => page.locator("nav a, aside a").filter({ hasText: new RegExp(`^\\s*${label}`) });
try {
  await r.signIn();
  await page.getByRole("heading", { name: "Overview" }).waitFor({ timeout: 30000 });
  await wait(1800);
  mark("overview");
  await hover(page.getByText("On route", { exact: true }), 700);
  await hover(page.getByText("Needs rider", { exact: true }), 800);
  await hover(page.getByText("Dispatch queue", { exact: true }), 900);
  await scroll(360); await wait(900); await scroll(-360); await wait(400);

  mark("orders");
  await press(nav("Orders"), { pause: 2600 });
  await press(page.getByText("OERN-30C79A722A"), { pause: 2400 });
  await hover(page.getByText("Dispatch map").first(), 1000);
  await scroll(460, 1000); await wait(1200);

  mark("jobs");
  await press(nav("Jobs"), { pause: 300 });
  await page.getByText(/Job board/).waitFor({ timeout: 30000 });
  const toast = page.getByText(/posted as|Grouped|Nothing to post|Nothing is waiting/).first();
  await toast.waitFor({ timeout: 15000 }).catch(() => {});
  console.log("toast:", await toast.textContent().catch(() => "(none)"));
  await r.snap("jobs");
  await wait(900);
  for (const col of ["Open", "On the road", "Done"]) {
    const h = page.locator(".jobs-board-column h3").filter({ hasText: new RegExp(`^${col}`) });
    if (await h.count()) await hover(h, 800);
  }
  await hover(page.locator('.jobs-board-column[data-status="open"] .task-card').first(), 1500);

  mark("tracking");
  await press(nav("Live tracking"), { pause: 3000 });
  await press(page.getByText("SIM-C03", { exact: true }).first(), { pause: 2000 });
  await press(page.getByText("SIM-C05", { exact: true }).first(), { pause: 2000 });

  mark("routelab");
  await press(nav("Route lab"), { pause: 3200 });
  await hover(page.getByText("Search steps").first(), 700);
  const sb = await page.locator('input[type="range"]').first().boundingBox();
  const at = (v) => sb.x + 8 + ((sb.width - 16) * (v - 3)) / 37;
  await glide(at(14), sb.y + sb.height / 2, 16);
  await drag(at(26), sb.y + sb.height / 2);
  await wait(2600);
  await hover(page.getByText("Planned routes").first(), 1300);

  mark("vehicles");
  await press(nav("Vehicles"), { pause: 2400 });
  await hover(page.getByText("DYN-SEED-E-BIKE").first(), 700);
  await hover(page.getByText("DYN-SEED-MOTO").first(), 900);

  mark("cod");
  await press(nav("COD ledger"), { pause: 2400 });
  await hover(page.getByText("To settle", { exact: true }).first(), 700);
  await press(page.getByRole("tab", { name: /Group by rider/ }), { pause: 2200 });

  mark("flood");
  await press(nav("Flood watch"), { pause: 3200 });
  await hover(page.getByText("Hlaing River Lowlands").first(), 1500);
  await wait(800);
} catch (e) {
  console.error("FAILED:", e.message);
  await r.snap("fail");
}
await r.finish();
