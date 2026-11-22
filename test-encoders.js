/* Verifies every symbology in public/js/symbologies.js renders via bwip-js. */
const fs = require('fs');
const path = require('path');
const bwipjs = require('bwip-js');

// Load browser symbology catalogue (it sets window.*)
global.window = {};
require(path.join(__dirname, 'public/js/symbologies.js'));
const SYM = window.SYMBOLOGIES;

const ONE_D = ['code39','code93','code128','gs1-128','ean13','ean8','upca','upce',
  'itf14','i2of5','codabar','msi','code11','pharma','telepen','databar'];

(async () => {
  let ok = 0;
  const fails = [];
  for (const s of SYM) {
    const opts = { bcid: s.bwip, text: s.value, scale: 3 };
    if (ONE_D.includes(s.id)) { opts.includetext = true; opts.height = 10; }
    if (s.id === 'gs1-128' || s.id === 'databar') opts.parsefnc = true;
    if (s.id === 'maxicode') opts.mode = 4;
    try {
      const buf = await bwipjs.toBuffer(opts);
      if (!buf || buf.length < 100) throw new Error('empty buffer');
      ok++;
      console.log('OK   ', s.id.padEnd(10), s.bwip.padEnd(20), s.value);
    } catch (e) {
      fails.push(s.id + ' (' + s.bwip + '): ' + e.message.split('\n')[0]);
      console.log('FAIL ', s.id.padEnd(10), s.bwip.padEnd(20), e.message.split('\n')[0]);
    }
  }
  console.log(`\n${ok}/${SYM.length} encoders OK`);
  process.exit(fails.length ? 1 : 0);
})();
