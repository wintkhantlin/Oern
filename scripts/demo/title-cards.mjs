// Role slides: the role name in big text with one centered subtitle. No other decoration.
import { chromium } from "playwright";
const OUT = new URL("../../output/demo-recording/", import.meta.url).pathname;
export const CARDS = [
  ["driver", "Driver", "Deliver parcels, collect payments, and find fuel stations."],
  ["customer", "Customer", "Book a parcel pickup and track your parcel."],
  ["manager", "Manager", "Manage all deliveries from one place."],
];
if (import.meta.url === `file://${process.argv[1]}`) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  for (const [id, title, line] of CARDS) {
    await p.setContent(`<!doctype html><html><head><style>
      body{margin:0;width:1920px;height:1080px;background:#1b2433;color:#fff;font-family:Inter,"Helvetica Neue",Arial,sans-serif;
        display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
      h1{margin:0;font-size:170px;font-weight:800;letter-spacing:-.03em;line-height:1}
      p{margin:36px 0 0;font-size:44px;font-weight:500;color:rgba(255,255,255,.75)}
    </style></head><body><h1>${title}</h1><p>${line}</p></body></html>`);
    await p.screenshot({ path: `${OUT}card-${id}.png` });
  }
  await b.close();
}
