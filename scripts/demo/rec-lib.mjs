// Shared helpers for the feature walkthrough recordings (Playwright video).
import { chromium } from "playwright";
import { planMove, planScroll, between, MOUSE } from "./mouse-model.mjs";

export const BASE = process.env.DEMO_BASE ?? "https://oern-app.vercel.app";
export const OUT = new URL("../../output/demo-recording/", import.meta.url).pathname;
export const ACCOUNTS = {
  rider: "rider.testing@oern.example",
  manager: "manager.testing@oern.example",
  customer: "wintkhantlin@gmail.com",
};

// Visible pointer: a neutral cursor on desktop, a soft touch dot on mobile.
const overlay = (mobile) => `
(() => {
  const mobile = ${mobile};
  const install = () => {
    if (document.getElementById("__demo_ptr")) return;
    const s = document.createElement("style");
    s.textContent = \`
      #__demo_ptr{position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);transition:opacity .2s}
      #__demo_ptr.cursor{width:22px;height:22px}
      #__demo_ptr.touch{width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;background:rgba(40,40,40,.28);border:2px solid rgba(255,255,255,.85);box-shadow:0 1px 6px rgba(0,0,0,.25);opacity:0}
      .__demo_ripple{position:fixed;z-index:2147483646;pointer-events:none;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;border:2px solid rgba(60,60,60,.55);animation:__demo_r .45s ease-out forwards}
      @keyframes __demo_r{to{transform:scale(3.2);opacity:0}}
      nextjs-portal{display:none!important}\`;
    document.documentElement.appendChild(s);
    const p = document.createElement("div");
    p.id = "__demo_ptr";
    p.className = mobile ? "touch" : "cursor";
    if (!mobile) p.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 17 L7 13.2 L9.8 19.5 L12.3 18.4 L9.6 12.3 L15 12.3 Z" fill="#1d1d1f" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(p);
    let hideT;
    const move = (x, y) => { p.style.transform = "translate(" + x + "px," + y + "px)"; };
    const ripple = (x, y) => { const r = document.createElement("div"); r.className = "__demo_ripple"; r.style.left = x + "px"; r.style.top = y + "px"; document.documentElement.appendChild(r); setTimeout(() => r.remove(), 500); };
    addEventListener("pointermove", e => { move(e.clientX, e.clientY); }, true);
    addEventListener("pointerdown", e => { move(e.clientX, e.clientY); ripple(e.clientX, e.clientY); if (mobile) { clearTimeout(hideT); p.style.opacity = 1; } }, true);
    addEventListener("pointerup", () => { if (mobile) hideT = setTimeout(() => p.style.opacity = 0, 350); }, true);
    addEventListener("touchstart", e => { const t = e.touches[0]; if (!t) return; move(t.clientX, t.clientY); ripple(t.clientX, t.clientY); clearTimeout(hideT); p.style.opacity = 1; }, true);
    addEventListener("touchend", () => { hideT = setTimeout(() => p.style.opacity = 0, 350); }, true);
    if (window.__demoLast) move(...window.__demoLast);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install); else install();
})();`;

export async function open(role, { mobile, name, geo, mockGeo }) {
  const browser = await chromium.launch();
  const vp = mobile ? { width: 390, height: 844 } : { width: 1600, height: 900 };
  const scale = mobile ? 2 : 1.2;
  const ctx = await browser.newContext({
    viewport: vp,
    deviceScaleFactor: scale,
    isMobile: mobile,
    hasTouch: mobile,
    locale: "en-US",
    timezoneId: "Asia/Yangon",
    ...(geo ? { geolocation: geo, permissions: ["geolocation"] } : {}),
    recordVideo: { dir: OUT + "raw-" + name, size: { width: Math.round(vp.width * scale), height: Math.round(vp.height * scale) } },
  });
  await ctx.addInitScript(overlay(mobile));
  if (mockGeo) {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("./mock-geo.js", import.meta.url), "utf8");
    await ctx.addInitScript(`window.__MOCK_GEO_START=${JSON.stringify(mockGeo)};\n${src}`);
  }
  const page = await ctx.newPage();
  const t0 = Date.now();
  const marks = [];
  const mark = (label) => { const t = (Date.now() - t0) / 1000; marks.push({ label, t }); console.log(`[${t.toFixed(1)}s] ${label}`); };
  const pos = { x: vp.width / 2, y: vp.height / 2 };

  // Plays planned samples in real time so the recorded motion keeps its timing.
  async function play(samples, step) {
    const start = Date.now();
    for (const smp of samples) {
      await step(smp);
      const due = start + smp.t * 1000 - Date.now();
      if (due > 0) await page.waitForTimeout(due);
    }
  }
  // Human pointing (see MOUSE_MOVEMENT.md): Fitts timing, minimum-jerk speed, undershoot + correction.
  async function glide(x, y, width = 40) {
    const samples = planMove({ x: pos.x, y: pos.y }, { x, y }, width);
    await play(samples, (smp) => page.mouse.move(smp.x, smp.y));
    pos.x = x; pos.y = y;
  }
  async function center(locator) {
    await locator.scrollIntoViewIfNeeded({ timeout: 15000 }).catch(() => {});
    const b = await locator.boundingBox({ timeout: 15000 });
    if (!b) throw new Error("no box");
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
  }
  // Desktop: glide then click. Mobile: tap.
  async function press(locator, { pause = 500 } = {}) {
    const loc = locator.first();
    await loc.waitFor({ state: "visible", timeout: 20000 });
    const c = await center(loc);
    if (mobile) {
      await page.waitForTimeout(250);
      await page.touchscreen.tap(c.x, c.y);
    } else {
      // Aim point: people click near, not exactly at, the centre of a control.
      const ax = c.x + (Math.random() - 0.5) * Math.min(12, c.b.width * 0.3);
      const ay = c.y + (Math.random() - 0.5) * Math.min(6, c.b.height * 0.3);
      await glide(ax, ay, Math.min(c.b.width, c.b.height));
      await page.waitForTimeout(between(MOUSE.aimDwell));
      await page.mouse.down(); await page.waitForTimeout(between(MOUSE.pressHold)); await page.mouse.up();
    }
    await page.waitForTimeout(pause);
  }
  async function hover(locator, pause = 700) {
    const c = await center(locator.first());
    await glide(c.x + (Math.random() - 0.5) * Math.min(16, c.b.width * 0.3), c.y, Math.min(c.b.width, c.b.height));
    await page.waitForTimeout(pause);
  }
  // Pointer-driven swipe for SwipeConfirm controls.
  async function swipe(locator) {
    const loc = locator.first();
    await loc.waitFor({ state: "visible", timeout: 20000 });
    await loc.scrollIntoViewIfNeeded();
    const b = await loc.boundingBox();
    const y = b.y + b.height / 2;
    await page.evaluate(([x, y]) => { const p = document.getElementById("__demo_ptr"); if (p) { p.style.opacity = 1; p.style.transform = `translate(${x}px,${y}px)`; } }, [b.x + 30, y]);
    await page.mouse.move(b.x + 30, y);
    await page.mouse.down();
    for (let i = 1; i <= 30; i++) { await page.mouse.move(b.x + 30 + ((b.width - 40) * i) / 30, y); await page.waitForTimeout(18); }
    await page.mouse.up();
    await page.evaluate(() => setTimeout(() => { const p = document.getElementById("__demo_ptr"); if (p && p.classList.contains("touch")) p.style.opacity = 0; }, 350));
  }
  async function scroll(dy, ms = 900) {
    await play(planScroll(dy, ms / 1000), (smp) => page.mouse.wheel(0, smp.dy));
  }
  // Press, move with the same human profile, release (sliders, map drags).
  async function drag(x, y) {
    await page.waitForTimeout(between(MOUSE.aimDwell));
    await page.mouse.down();
    await glide(x, y, 24);
    await page.waitForTimeout(80);
    await page.mouse.up();
  }
  async function type(locator, text) {
    await press(locator, { pause: 200 });
    await page.keyboard.type(text, { delay: 45 });
  }
  async function signIn() {
    await page.goto(BASE + "/signin", { waitUntil: "networkidle" });
    mark("signin");
    await page.waitForTimeout(800);
    await type(page.locator("input[type=email]"), ACCOUNTS[role]);
    await type(page.locator("input[type=password]"), "password");
    await press(page.locator("button[type=submit]"), { pause: 0 });
    await page.waitForURL((u) => !u.pathname.startsWith("/signin"), { timeout: 30000 });
    mark("signed-in");
  }
  async function snap(label) {
    await page.screenshot({ path: `${OUT}shot-${name}-${label}.png` });
  }
  async function finish() {
    mark("end");
    const video = page.video();
    await ctx.close();
    await browser.close();
    const path = await video.path();
    const fs = await import("node:fs");
    fs.writeFileSync(`${OUT}${name}.marks.json`, JSON.stringify({ video: path, marks }, null, 2));
    console.log("video:", path);
  }
  return { page, ctx, mark, glide, drag, press, hover, swipe, scroll, type, signIn, snap, finish, wait: (ms) => page.waitForTimeout(ms) };
}
