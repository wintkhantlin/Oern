// Renders YouTube-style caption cues as transparent 1920x1080 PNGs, plus the phone mask and shadow.
// Cues come from output/demo-recording/cues.json (written by build.py): [{ id, lines: [..], pos }].
// Style follows YouTube's default player captions: white sans text, one translucent black bar per line,
// bottom centre, no animation.
import fs from "node:fs";
import { chromium } from "playwright";

const DIR = new URL("../../output/demo-recording/", import.meta.url).pathname;
const OUT = `${DIR}captions/`;
// Phone screen placement in the 16:9 frame (keep in sync with build.py).
export const PHONE = { w: 416, h: 900, x: 752, y: 40, r: 30 };

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const cues = fs.existsSync(`${DIR}cues.json`) ? JSON.parse(fs.readFileSync(`${DIR}cues.json`, "utf8")) : [];
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
const base = `html,body{margin:0;background:transparent;width:1920px;height:1080px}`;
const font = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@500&display=block">`;
for (const cue of cues) {
  const lines = cue.lines.map((l) => `<span>${esc(l)}</span>`).join("<br>");
  await p.setContent(`<!doctype html><html><head>${font}<style>${base}
    .cc{position:absolute;left:0;right:0;text-align:center;bottom:${cue.pos === "top" ? "auto" : "14px"};top:${cue.pos === "top" ? "88px" : "auto"};
      font-family:Roboto,"Helvetica Neue",Arial,sans-serif;font-weight:500;font-size:38px;line-height:1.4;color:#fff}
    .cc span{background:rgba(8,8,8,.75);padding:1px 12px;box-decoration-break:clone;-webkit-box-decoration-break:clone}
  </style></head><body><div class="cc">${lines}</div></body></html>`, { waitUntil: "networkidle" });
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: `${OUT}${cue.id}.png`, omitBackground: true });
}
// Rounded-corner mask (white = visible) and a soft shadow for the phone screen.
await p.setViewportSize({ width: PHONE.w, height: PHONE.h });
await p.setContent(`<html><body style="margin:0;background:#000"><div style="width:${PHONE.w}px;height:${PHONE.h}px;border-radius:${PHONE.r}px;background:#fff"></div></body></html>`);
await p.screenshot({ path: `${OUT}_phone-mask.png` });
await p.setViewportSize({ width: 1920, height: 1080 });
await p.setContent(`<html><head><style>${base}</style></head><body><div style="position:absolute;left:${PHONE.x}px;top:${PHONE.y}px;width:${PHONE.w}px;height:${PHONE.h}px;border-radius:${PHONE.r}px;box-shadow:0 24px 60px rgba(0,0,0,.45)"></div></body></html>`);
await p.screenshot({ path: `${OUT}_phone-shadow.png`, omitBackground: true });
await b.close();
console.log(cues.length, "caption cues");
