import { open } from "./rec-lib.mjs";
// Driver take 9 (local build, no delivery): from the stop just delivered, head toward the next stop,
// detour to the nearest fuel station, tap Done and continue. Every drive follows the exact road route
// the app itself fetched from Mapbox (captured from its network responses).
// Run with DEMO_BASE=http://localhost:3000.
const START = { latitude: 16.818, longitude: 96.152 }; // the stop delivered in take 8
const r = await open("rider", { mobile: true, name: "rider-v9", mockGeo: START });
const { page, mark, press, wait } = r;
const routes = [];
page.on("response", async (res) => {
  const url = res.url();
  if (!url.includes("/directions/v5/")) return;
  const path = decodeURIComponent(new URL(url).pathname.split("/").pop()).split(";").map((p) => p.split(",").map(Number));
  if (path.length !== 2) return;
  try { const j = await res.json(); if (j.routes?.[0]) routes.push({ at: Date.now(), to: path[1], coords: j.routes[0].geometry.coordinates }); console.log("route ->", path[1].join(","), j.routes?.length); } catch (e) { console.log("route err", e.message); }
});
const near = (a, b) => Math.hypot((a[0] - b[0]) * 106000, (a[1] - b[1]) * 111000) < 40;
async function routeTo(predicate, since) {
  for (let i = 0; i < 40; i++) {
    const hit = [...routes].reverse().find((x) => x.at >= since && predicate(x.to));
    if (hit) return hit;
    await wait(250);
  }
  throw new Error("no app route captured");
}
const lengthM = (c) => c.slice(1).reduce((s, p, i) => s + Math.hypot((p[0] - c[i][0]) * 106000, (p[1] - c[i][1]) * 111000), 0);
const firstMeters = (c, m) => { let s = 0; const out = [c[0]]; for (let i = 1; i < c.length && s < m; i++) { s += Math.hypot((c[i][0] - c[i - 1][0]) * 106000, (c[i][1] - c[i - 1][1]) * 111000); out.push(c[i]); } return out; };
const here = () => page.evaluate(() => new Promise((ok) => navigator.geolocation.getCurrentPosition((p) => ok([p.coords.longitude, p.coords.latitude]))));
const drive = async (c, mPerS = 80) => { const ms = Math.max(4000, (lengthM(c) / mPerS) * 1000); await page.evaluate(([c, ms]) => window.__mockGeo.drive(c, ms), [c, ms]); };
try {
  await r.signIn();
  await page.getByRole("heading", { name: /Jobs/ }).waitFor({ timeout: 30000 });
  await wait(1200);
  let t;
  await press(page.getByText("Open route").first(), { pause: 500 });
  await page.getByRole("button", { name: "Confirm arrival" }).waitFor({ timeout: 30000 });
  // The app prefetches this leg while the job board is open, so accept any capture.
  const toNext = await routeTo((to) => near(to, [96.156, 16.82]), 0);
  await wait(2500);
  mark("onward");
  await drive(firstMeters(toNext.coords, 450)); await wait(800);
  mark("fuel");
  await press(page.getByRole("button", { name: "Shift tools" }), { pause: 1300 });
  await press(page.getByRole("button", { name: /Find fuel stop/ }), { pause: 2600 });
  console.log("station:", (await page.locator(".rf-fuel-card").innerText()).replace(/\n+/g, " | "));
  t = Date.now();
  await press(page.getByRole("button", { name: /Detour now/ }), { pause: 300 });
  const toFuel = await routeTo((to) => !near(to, toNext.to), t);
  console.log("pitstop route", Math.round(lengthM(toFuel.coords)), "m,", toFuel.coords.length, "pts");
  await wait(1800);
  mark("pitstop");
  await drive([await here(), ...toFuel.coords, toFuel.to]); await wait(2200);
  await r.snap("at-station");
  mark("done");
  t = Date.now();
  await press(page.getByRole("button", { name: /^Done$/ }), { pause: 300 });
  const back = await routeTo((to) => !near(to, toFuel.to), t);
  await wait(1800);
  mark("continue");
  await drive([await here(), ...firstMeters(back.coords, 650)]); await wait(2500);
  await r.snap("end");
} catch (e) {
  console.error("FAILED:", e.message);
  await r.snap("fail");
}
await r.finish();
