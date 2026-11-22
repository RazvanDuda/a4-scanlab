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

## Deploy to Cloudflare Pages

The repo is Pages-ready: static assets in `public/`, API in `functions/` (Pages Functions),
sessions stored in Cloudflare KV.

**Option A — dashboard (easiest):**
1. Push the repo to GitHub, then in Cloudflare: *Workers & Pages → Create → Pages → Connect to Git*.
2. Build settings: framework preset **None**, build command *(empty)*, output dir **`public`**.
3. Create a KV namespace (*Storage & Databases → KV → Create*, name it `SESSIONS`).
4. In the Pages project: *Settings → Bindings → Add → KV namespace*, variable name
   **`SESSIONS`**, pick the namespace. Redeploy.

**Option B — wrangler CLI:**
```bash
npm i -g wrangler
wrangler login
wrangler kv namespace create SESSIONS     # paste the id into wrangler.toml
npx wrangler pages deploy public          # first time: it creates the project
```

After deploying, the printed QR links automatically use your `https://<project>.pages.dev`
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
