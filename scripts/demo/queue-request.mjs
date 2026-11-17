import { open } from "./rec-lib.mjs";
// Off-camera: the customer places one pickup request so the manager's Jobs automation has something to post.
const r = await open("customer", { mobile: true, name: "queue-request", geo: { latitude: 16.8053, longitude: 96.1311, accuracy: 10 } });
const { page, press, type, wait } = r;
try {
  await r.signIn();
  await page.getByText(/Hi, /).first().waitFor({ timeout: 30000 });
  await page.goto(page.url().replace(/\/home.*/, "/pickup"));
  await press(page.getByRole("button", { name: "Use my location" }).first(), { pause: 2500 });
  await type(page.getByPlaceholder(/12 Baho Road/), "Sanchaung"); await wait(2500);
  await press(page.locator('[role="option"]').filter({ hasText: /Yangon/ }).first(), { pause: 1200 });
  await press(page.getByRole("button", { name: /Next: parcel/ }), { pause: 1800 });
  await type(page.getByPlaceholder("Who should receive it?"), "Recipient"); await type(page.getByPlaceholder(/09 xxx/), "09 975 540 768");
  await press(page.getByRole("button", { name: /Next: payment/ }), { pause: 2000 });
  await press(page.getByRole("button", { name: /Next: review/ }), { pause: 2000 });
  await press(page.getByRole("button", { name: /Request pickup/ }), { pause: 4000 });
  console.log("sent:", (await page.getByText(/tracking code is/).textContent().catch(() => "?")));
} catch (e) { console.error("FAILED:", e.message); await r.snap("fail"); }
await r.finish();
