import { open } from "./rec-lib.mjs";
// Customer take: request a pickup pinned on the map in Insein, then track the new order.
const DRY = process.env.DRY === "1";
const r = await open("customer", { mobile: true, name: DRY ? "customer-dry" : "customer-v5", geo: { latitude: 16.8053, longitude: 96.1311, accuracy: 10 } });
const { page, mark, press, type, wait } = r;
const wheel = async (dy) => { for (let i = 0; i < 14; i++) { await page.mouse.wheel(0, dy / 14); await wait(45); } };
async function drag(dx, dy) {
  const x = 195, y = 330;
  await page.evaluate(([x, y]) => { const p = document.getElementById("__demo_ptr"); if (p) { p.style.opacity = 1; p.style.transform = `translate(${x}px,${y}px)`; } }, [x, y]);
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 24; i++) { await page.mouse.move(x + (dx * i) / 24, y + (dy * i) / 24); await wait(25); }
  await page.mouse.up();
  await page.evaluate(() => setTimeout(() => { const p = document.getElementById("__demo_ptr"); if (p) p.style.opacity = 0; }, 300));
}
try {
  await r.signIn();
  await page.getByText(/Hi, /).first().waitFor({ timeout: 30000 });
  await wait(2000);
  mark("home");
  await wheel(380); await wait(900); await wheel(-380); await wait(500);

  mark("pickup");
  await press(page.getByRole("link", { name: "Pickup" }).last(), { pause: 1800 });
  await press(page.getByRole("button", { name: "Pickup on map" }), { pause: 2500 });
  mark("map");
  await type(page.getByPlaceholder("Search a street, shop or landmark"), "Insein");
  await wait(2200);
  await r.snap("map-search");
  const opt = page.locator('ul[aria-label="Matching places"] li').filter({ hasText: /Insein/ }).first();
  await press(opt.locator("button, [role=button], div").first(), { pause: 3000 });
  await drag(-40, 60); await wait(1500);
  await r.snap("map-pinned");
  await press(page.getByRole("button", { name: "Confirm pickup spot" }), { pause: 2200 });
  mark("delivery");
  await type(page.getByPlaceholder(/12 Baho Road/), "Sanchaung");
  await wait(2500);
  await press(page.locator('[role="option"]').filter({ hasText: /Yangon/ }).first(), { pause: 1200 });
  // The search knows townships only, so add the house number and street in front of it.
  const drop = page.getByPlaceholder(/12 Baho Road/);
  await press(drop, { pause: 200 });
  await page.keyboard.press("Home");
  await page.keyboard.type("No. 27, Baho Road, ", { delay: 55 });
  await page.keyboard.press("Escape");
  await page.locator("h1, h2").first().click({ position: { x: 2, y: 2 } }).catch(() => {});
  await wait(1500);
  console.log("delivery address:", await drop.inputValue());
  await r.snap("route");
  await press(page.getByRole("button", { name: /Next: parcel/ }), { pause: 2000 });
  mark("details");
  await type(page.getByPlaceholder("Who should receive it?"), "Ko Htet Naing");
  await type(page.getByPlaceholder(/09 xxx/), "09 975 540 768");
  await press(page.getByRole("button", { name: /Afternoon/ }).or(page.getByRole("radio", { name: /Afternoon/ })).or(page.getByText(/^Afternoon/)), { pause: 900 });
  await press(page.getByRole("button", { name: /Next: payment/ }), { pause: 2500 });
  mark("fee");
  await r.snap("fee");
  await press(page.getByRole("button", { name: /Next: review/ }), { pause: 2500 });
  mark("review");
  await r.snap("review");
  await wheel(300); await wait(1200);
  if (!DRY) {
    await press(page.getByRole("button", { name: /Request pickup/ }), { pause: 4000 });
    mark("sent");
    await r.snap("sent");
    // Pay the fee with MMQR, then follow the order.
    await press(page.getByRole("link", { name: /with MMQR/ }), { pause: 4500 });
    mark("pay");
    const payBtn = page.getByRole("button", { name: "Pay with MMQR" });
    await payBtn.scrollIntoViewIfNeeded(); await wait(800);
    await press(payBtn, { pause: 600 });
    mark("qr");
    await page.getByText(/Payment received|Payment not confirmed/).waitFor({ timeout: 20000 });
    mark("paid");
    await wait(2200);
    await r.snap("paid");
    await press(page.getByRole("button", { name: "Back to order" }), { pause: 4000 });
    mark("track");
    await wheel(-600); await wait(2500);
    await r.snap("track");
  }
} catch (e) {
  console.error("FAILED:", e.message);
  await r.snap("fail");
}
await r.finish();
