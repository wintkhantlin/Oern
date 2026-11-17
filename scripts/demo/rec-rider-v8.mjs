import fs from "node:fs";
import { open } from "./rec-lib.mjs";
// Driver take 8 (local build): short drive to stop 8 and deliver it, drive on a little, detour to
// Max Energy Shwegondaing, tap Done, continue up Kaba Aye Pagoda Road toward the next stop.
// Run with DEMO_BASE=http://localhost:3000.
const load = (f) => JSON.parse(fs.readFileSync(new URL(`./${f}.json`, import.meta.url))).coordinates;
const toStop = load("route-to-stop"), toFuel = load("route-to-fuel"), after = load("route-after-fuel");
const cut = Math.ceil(toFuel.length * 0.45);
const PHOTO = new URL("./black-photo.jpg", import.meta.url).pathname;
const r = await open("rider", { mobile: true, name: "rider-v8", mockGeo: { latitude: toStop[0][1], longitude: toStop[0][0] } });
const { page, mark, press, swipe, wait } = r;
const primary = () => page.locator(".dv-collect-foot button.MuiButton-contained").first();
const drive = (c, ms) => page.evaluate(([c, ms]) => { window.__drive = window.__mockGeo.drive(c, ms); }, [c, ms]);
const arrived = () => page.evaluate(() => window.__drive);
try {
  await r.signIn();
  await page.getByRole("heading", { name: /Jobs/ }).waitFor({ timeout: 30000 });
  await wait(1500);
  await press(page.getByText("Open route").first(), { pause: 500 });
  await page.getByRole("button", { name: "Confirm arrival" }).waitFor({ timeout: 30000 });
  await wait(3000);
  mark("drive-stop");
  await drive(toStop, 7000); await arrived(); await wait(1800);
  mark("arrive");
  await press(page.getByRole("button", { name: "Confirm arrival" }), { pause: 1200 });
  for (const name of ["Confirm anyway", "Confirm delivery"]) {
    const b = page.getByRole("button", { name, exact: true });
    if (await b.isVisible().catch(() => false)) await press(b, { pause: 1300 });
  }
  mark("handover");
  const boxes = page.locator(".dv-check-box");
  for (let i = 0; i < (await boxes.count()); i++) await press(boxes.nth(i), { pause: 500 });
  await press(primary(), { pause: 1000 });
  await press(page.locator(".dv-seg label").first(), { pause: 800 });
  await press(primary(), { pause: 1000 });
  await press(page.locator(".dv-step").getByText(/Take a photo/).first(), { pause: 300 });
  await page.locator('input[type="file"]').setInputFiles(PHOTO);
  await wait(1300);
  await press(primary(), { pause: 1400 });
  mark("cash");
  await r.snap("cash");
  await swipe(page.locator(".dv-swipe").last());
  mark("delivered");
  await wait(6000);
  await r.snap("next-stop");
  mark("drive-a");
  await drive(toFuel.slice(0, cut), 9000); await arrived(); await wait(800);
  mark("fuel");
  await press(page.getByRole("button", { name: "Shift tools" }), { pause: 1300 });
  await press(page.getByRole("button", { name: /Find fuel stop/ }), { pause: 2600 });
  await r.snap("fuel-card");
  await press(page.getByRole("button", { name: /Detour now/ }), { pause: 2200 });
  mark("drive-fuel");
  await drive(toFuel.slice(cut - 1), 9000); await arrived(); await wait(2200);
  await r.snap("at-station");
  mark("refuel-done");
  await press(page.getByRole("button", { name: /^Done$/ }), { pause: 2200 });
  mark("drive-after");
  await drive(after, 10000); await arrived(); await wait(2500);
  await r.snap("end");
} catch (e) {
  console.error("FAILED:", e.message);
  await r.snap("fail");
}
await r.finish();
