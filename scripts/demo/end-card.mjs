// Ending card: the Oern mascot with the name, tagline and demo address, on the same navy as the role slides.
// Renders the static text layer and the mascot separately so build.py can run the mascot in once.
import fs from "node:fs";
import { chromium } from "playwright";
const OUT = new URL("../../output/demo-recording/", import.meta.url).pathname;
const ROOT = new URL("../../", import.meta.url).pathname;
export const END = { title: "Oern", line: "Door-to-door delivery for Yangon.", url: "oern-app.vercel.app" };
// Mascot box in the 1920x1080 frame (keep in sync with build.py).
export const MASCOT = { x: 150, y: 210, size: 660 };
const mascot = `data:image/png;base64,${fs.readFileSync(`${ROOT}public/brand/oern-character.png`).toString("base64")}`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await p.setContent(`<!doctype html><html><head><style>
  body{margin:0;width:1920px;height:1080px;background:#1b2433;color:#fff;font-family:Inter,"Helvetica Neue",Arial,sans-serif}
  .copy{position:absolute;left:900px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center}
  h1{margin:0;font-size:170px;font-weight:800;letter-spacing:-.03em;line-height:1}
  p{margin:32px 0 0;font-size:44px;font-weight:500;color:rgba(255,255,255,.75)}
  .url{margin-top:56px;align-self:flex-start;background:#c2410c;color:#fff;border-radius:999px;padding:18px 40px;font-size:36px;font-weight:600}
</style></head><body><div class="copy"><h1>${END.title}</h1><p>${END.line}</p><div class="url">${END.url}</div></div></body></html>`);
await p.screenshot({ path: `${OUT}end-bg.png` });
await p.setViewportSize({ width: MASCOT.size, height: MASCOT.size });
await p.setContent(`<html><body style="margin:0;background:transparent"><img src="${mascot}" style="width:${MASCOT.size}px;height:${MASCOT.size}px;display:block"></body></html>`);
await p.screenshot({ path: `${OUT}end-mascot.png`, omitBackground: true });
await b.close();
