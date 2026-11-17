import { open } from "./rec-lib.mjs";
// Driver take 4a: take the 8-stop Yangon job from north Kamayut and show the route overview.
const START = { latitude: 16.835, longitude: 96.127 };
const r = await open("rider", { mobile: true, name: "rider-v4a", mockGeo: START });
const { page, mark, press, swipe, wait } = r;
try {
  await r.signIn();
  await page.getByRole("heading", { name: /Jobs/ }).waitFor({ timeout: 30000 });
  await wait(1800);
  mark("jobs");
  const card = page.locator("li").filter({ hasText: /8\s*stops\s*Yangon/ }).first();
  await press(card.locator("button").first(), { pause: 1400 });
  mark("swipe-take");
  await swipe(card.locator(".dv-swipe"));
  await page.getByRole("button", { name: "Confirm arrival" }).waitFor({ timeout: 30000 });
  mark("active");
  await wait(2500);
  const expand = page.getByRole("button", { name: /Show stop details/ });
  await press(expand, { pause: 3000 });
  await r.snap("details");
  console.log("TEXT:", (await page.locator("main").innerText()).replace(/\n+/g, " | ").slice(0, 1500));
  await page.mouse.wheel(0, 400); await wait(1500);
  await r.snap("details2");
  await page.mouse.wheel(0, -400); await wait(800);
  await press(page.getByRole("button", { name: /Show less/ }), { pause: 1500 });
} catch (e) {
  console.error("FAILED:", e.message);
  await r.snap("fail");
}
await r.finish();
