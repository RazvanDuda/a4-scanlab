# A4 ScanLab — Barcode Print Tester + Mobile Validator

Print a test sheet of barcodes on A4, then verify every printed symbol with your phone's camera.

Two tools in one small web app:

1. **Desktop generator (`/`)** — pick barcode symbologies and generate a numbered **A4 print test
   sheet** (24 symbology types: Code 39/93/128, GS1-128, EAN-13/8, UPC-A/E, ITF-14,
   Interleaved 2 of 5, Codabar, MSI, Code 11, Pharmacode, Telepen, GS1 DataBar, QR, Data Matrix,
   GS1 Data Matrix, PDF417, MicroPDF417, Aztec, Micro QR, MaxiCode). A QR code at the top of the
   sheet links to the mobile validator with the sheet preloaded. Optional print-quality test strip.

2. **Mobile validator (`/validate`)** — open on your phone, enter the session code from the sheet
   or scan the sheet's QR. The camera scans each printed barcode:
   - **Auto-match mode** — scan any code, it's matched against the sheet automatically.
   - **One-by-one mode** — tap the checklist item, then scan.
   - PASS / WARN (wrong symbology) / FAIL per item, with beep + vibration.
   - Final **validation report** you can copy.

## Scanning engine (adaptive)

- Android Chrome: native `BarcodeDetector` API.
- Everything else (iOS Safari, desktop): **zxing-cpp compiled to WASM** — reads every sheet
  symbology, including Code 93, UPC-E, GS1 DataBar, Telepen, Micro QR and MaxiCode.
- **Size-adaptive decoding**: each frame cycles three strategies — full frame, 2× center-crop
  zoom (small codes), 0.5× downscale (huge codes) — so both tiny and oversized barcodes decode.
- Quiet zones are added around every rendered symbol (bwip-js omits them by default).

## Deploy to Cloudflare (Workers)

The repo deploys as a **Worker with static assets**: the app in `public/`, API routes in
`worker.js`, sessions in Cloudflare KV.

1. Create a KV namespace: *Storage & Databases → KV → Create* (name it `SESSIONS`), or
   `npx wrangler kv namespace create SESSIONS`.
2. Paste its **id** into `wrangler.toml` (uncomment the `[[kv_namespaces]]` block).
3. Push — the Workers git build runs `npx wrangler deploy` and goes green. Or run
   `npx wrangler deploy` locally.

Until KV is bound, the site still works; only creating/fetching sessions returns an error.

*A Pages-project setup also works: static dir `public`, Pages Functions in `functions/`
(mirrored API), KV binding `SESSIONS` in the dashboard.*

After deploying, the printed QR links automatically use your `https://barcode.<your-subdomain>.workers.dev`
origin — the camera works out of the box (no self-signed certificate step).

## Run locally (LAN mode)

```bash
npm install
npm start          # or: PORT=8080 node server.js
```

The local Node server stores sessions in `sessions.json` and also starts an **HTTPS listener
(:8443)** with a self-signed cert, because iOS/Chrome only expose the camera in a secure
context. Open the printed `https://…:8443` URL on your phone and accept the warning.

## Workflow

1. On the computer: choose symbologies & values → **Generate sheet** → **Print (A4)**
   (paper A4, scale 100%, margins default/none — do NOT use "fit to page").
2. On the phone: open the printed QR (or `/validate` + session code).
3. Scan each printed barcode one by one until the checklist is green.
4. Copy the validation report for your records.

## Notes

- Types with no common phone decoder (**MSI, Code 11, Pharmacode**) are visual-check only.
- On Cloudflare, sessions live in KV for 180 days; results are kept per device in `localStorage`.
- `npm run test:encoders` verifies every symbology renders with bwip-js.
