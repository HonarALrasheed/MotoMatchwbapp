/**
 * MotoMatch — Material für Fahrschulen (2026-10-05)
 *
 * Fahrschüler sind genau die Leute, die bald ihr erstes Motorrad suchen. Fahrschulen bekommen
 * kostenlos ein A4-Plakat mit QR-Code für den Unterrichtsraum und ein Banner mit Link für ihre
 * Website (ein echter Link, kein iframe — die App darf wegen frame-ancestors 'none' nicht
 * eingebettet werden). Alles landet unter public/fahrschulen/, die Seite dazu ist
 * public/fuer-fahrschulen/index.html.
 *
 * Der QR-Code kommt von außen (macOS CoreImage, siehe scratchpad/fs/qr.swift — keine Abhängigkeit):
 *   PLAYWRIGHT=/pfad/zu/playwright-core node scripts/fahrschulen/bauen.mjs <qr.png>
 */
import { readFileSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), "../..");
const ZIEL = join(WURZEL, "public/fahrschulen");
const QR = process.argv[2];
if (!QR) { console.error("QR-Bild fehlt"); process.exit(1); }

const daten = (p, typ) => `data:${typ};base64,${readFileSync(p).toString("base64")}`;
const schrift = Object.fromEntries([500, 600, 800].map((w) => [w, daten(join(WURZEL, `public/fonts/barlow-${w}.woff2`), "font/woff2")]));
const bild = (rel) => daten(join(WURZEL, "public", rel), "image/webp");
const qr = daten(QR, "image/png");

const FONTS = `
  @font-face{font-family:B;font-weight:500;src:url(${schrift[500]})}
  @font-face{font-family:B;font-weight:600;src:url(${schrift[600]})}
  @font-face{font-family:B;font-weight:800;src:url(${schrift[800]})}
  *{margin:0;box-sizing:border-box}`;

// A4 hoch, 794 × 1123 CSS-Pixel
const plakat = `<!doctype html><html><head><meta charset="utf-8"><style>${FONTS}
  @page{size:A4;margin:0}
  body{width:794px;height:1123px;background:#0d0d0e;color:#fff;font-family:B,sans-serif;position:relative;overflow:hidden}
  .marke{position:absolute;top:44px;left:56px;font-weight:800;font-size:20px;letter-spacing:.32em}
  .kopf{position:absolute;top:96px;left:56px;right:56px}
  h1{font-weight:800;font-size:62px;line-height:1;letter-spacing:-.015em}
  .unter{margin-top:22px;margin-right:40px;font-weight:500;font-size:22px;line-height:1.4;color:rgba(255,255,255,.72)}
  .bike{position:absolute;top:345px;left:-40px;width:874px;height:520px;background:url(${bild("bikes/showroom/yamaha_mt07_2022.webp")}) center/cover;
    -webkit-mask-image:linear-gradient(#0000 0,#000 14%,#000 82%,#0000 100%),linear-gradient(90deg,#0000 0,#000 12%,#000 88%,#0000 100%);-webkit-mask-composite:source-in}
  .fakten{position:absolute;top:790px;left:56px;display:flex;gap:10px}
  .fakten span{font-weight:600;font-size:16px;padding:9px 16px;border-radius:12px;background:rgba(255,255,255,.1)}
  .unten{position:absolute;left:56px;right:56px;bottom:56px;display:flex;align-items:center;gap:32px;background:#fff;color:#0d0d0e;border-radius:28px;padding:26px}
  .unten img{width:170px;height:170px;image-rendering:pixelated}
  .unten strong{display:block;font-weight:800;font-size:34px;line-height:1.05}
  .unten em{display:block;font-style:normal;font-weight:600;font-size:20px;margin-top:10px;color:#555}
  .unten small{display:block;font-weight:500;font-size:15px;margin-top:14px;color:#777}
  </style></head><body>
  <div class="marke">MOTOMATCH</div>
  <div class="kopf"><h1>Bald den Führer&shy;schein? Finde dein erstes Motorrad.</h1>
  <p class="unter">Kostenloses Quiz: 8 Fragen, über 1.000 Modelle — passend zu deinem Führerschein, Budget und deiner Körpergröße.</p></div>
  <div class="bike"></div>
  <div class="fakten"><span>A1 · A2 · A</span><span>mit Gebrauchtpreisen</span><span>ohne Anmeldung</span></div>
  <div class="unten"><img src="${qr}" alt=""><div><strong>Scannen und<br>Quiz starten</strong><em>motomatch.studio</em><small>Empfohlen von deiner Fahrschule</small></div></div>
  </body></html>`;

// Banner für Websites: 1200 × 400 (wird halb so groß angezeigt, scharf auf Retina)
const banner = `<!doctype html><html><head><meta charset="utf-8"><style>${FONTS}
  body{width:1200px;height:400px;background:#0d0d0e;color:#fff;font-family:B,sans-serif;position:relative;overflow:hidden}
  .bike{position:absolute;top:-20px;right:-60px;width:640px;height:480px;background:url(${bild("bikes/showroom/kawasaki_z650_2022.webp")}) center/cover;
    -webkit-mask-image:linear-gradient(90deg,#0000 0,#000 30%);}
  .marke{position:absolute;top:44px;left:56px;font-weight:800;font-size:22px;letter-spacing:.32em}
  h2{position:absolute;top:96px;left:56px;width:620px;font-weight:800;font-size:60px;line-height:1.02;letter-spacing:-.015em}
  .los{position:absolute;left:56px;bottom:48px;background:#fff;color:#0d0d0e;font-weight:800;font-size:28px;padding:18px 34px;border-radius:99px}
  .los em{font-style:normal;font-weight:500;color:#666;margin-left:10px}
  </style></head><body>
  <div class="bike"></div><div class="marke">MOTOMATCH</div>
  <h2>Welches Motorrad passt zu dir?</h2>
  <div class="los">Kostenloses Quiz starten <em>→</em></div>
  </body></html>`;

const { chromium } = await import(process.env.PLAYWRIGHT || "playwright-core");
mkdirSync(ZIEL, { recursive: true });
const browser = await chromium.launch();
const seite = await browser.newPage({ viewport: { width: 794, height: 1123 } });
await seite.setContent(plakat, { waitUntil: "load" });
await seite.evaluate(() => document.fonts.ready);
await seite.pdf({ path: join(ZIEL, "plakat-a4.pdf"), format: "A4", printBackground: true });
await seite.screenshot({ path: join(ZIEL, "plakat-vorschau.jpg"), type: "jpeg", quality: 82 });
await seite.setViewportSize({ width: 1200, height: 400 });
await seite.setContent(banner, { waitUntil: "load" });
await seite.evaluate(() => document.fonts.ready);
await seite.screenshot({ path: join(ZIEL, "banner.jpg"), type: "jpeg", quality: 86 });
await browser.close();
copyFileSync(QR, join(ZIEL, "qr-code.png"));
console.log("[fahrschulen] plakat-a4.pdf, plakat-vorschau.jpg, banner.jpg, qr-code.png");
