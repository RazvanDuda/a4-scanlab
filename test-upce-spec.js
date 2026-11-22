/* Round-trip test: construct UPC-E and Code-93 bitmaps MANUALLY from spec,
   decode with @zxing/library 0.21.3 readers. */
const ZX = require('@zxing/library');

function decode(lum, w, h, label, formats) {
  const src = new ZX.RGBLuminanceSource(lum, w, h);
  const bmp = new ZX.BinaryBitmap(new ZX.HybridBinarizer(src));
  const hints = new Map();
  hints.set(ZX.DecodeHintType.TRY_HARDER, true);
  if (formats) hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, formats.map(f => ZX.BarcodeFormat[f]));
  const reader = new ZX.MultiFormatReader();
  reader.setHints(hints);
  try { const r = reader.decode(bmp); console.log(label + ': OK "' + r.getText() + '" [' + ZX.BarcodeFormat[r.getBarcodeFormat()] + ']'); }
  catch (e) { console.log(label + ': FAIL ' + (e.message || e)); }
}

function bitmapFromModules(rows, scale, quiet, label, formats) {
  const s = quiet + rows + quiet;
  const w = s.length * scale, h = 20 * scale;
  const lum = new Uint8ClampedArray(w * h).fill(255);
  for (let x = 0; x < s.length; x++) if (s[x] === '1') for (let y = 0; y < h; y++) lum[y * w + x * scale + 0] = 0, fillBar(lum, w, h, x * scale, scale);
  function fillBar(l, W, H, px, sc) { for (let y = 0; y < H; y++) for (let dx = 0; dx < sc; dx++) l[y * W + px + dx] = 0; }
  decode(lum, w, h, label, formats);
}

// ---- UPC-E from spec (https://en.wikipedia.org/wiki/Universal_Product_Code#UPC-E) ----
// UPC-E: 0 + 6 data digits encoded per parity pattern + guard 010101
const UPCP = { // odd parity (1=odd) digit encodings, 7 modules
  odd:  ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'],
  even: ['0100111','0110011','0110101','0100011','0111011' /* wait */, '0101111','0001011' /* fix below */]
};
// correct even table
UPCP.even = ['0100111','0110011','0110101','0111011','0100011','0101111','0001011','0001101','0011001','0010011'];
// UPC-E number system 0, check digit 5 ('01234565': digits 0,1,2,3,4,5, check 6? actually last is check=5?) -> use standard example: 01234565 -> data 123456, parity "OOOOEE"? use table for check 5: OOEEE? Let's just use known example from spec: UPC-E 06500000 0? Simplify: use parity pattern for check digit 5, number system 0: 'OOEEE'? Table (check 5): 0=OOEEE... 
// wiki table: check digit 5 => 0: OOOEE? -- encode with parity string for check '5': OOEEE? We'll try all 6-digit data 123456 with each of the 2 possible parity tables used for check 5: OOEEE and EEOOO? 
const parities5 = ['OOEEE','OEOEE'? 0:0];
