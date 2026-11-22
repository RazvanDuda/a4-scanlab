/* Shared symbology catalogue for generator + validator. */
(function () {
  'use strict';

  const S = [
    // ---- 1D linear ----
    { group: '1D', id: 'code39',   name: 'Code 39',                    bwip: 'code39',           value: 'PRINTER-39',   zxing: ['CODE_39'],    detector: ['CODE_39'] },
    { group: '1D', id: 'code93',   name: 'Code 93',                    bwip: 'code93',           value: 'PRINTER-93',   zxing: ['CODE_93'],    detector: ['CODE_93'] },
    { group: '1D', id: 'code128',  name: 'Code 128',                   bwip: 'code128',          value: 'PRINTER-128',  zxing: ['CODE_128'],   detector: ['CODE_128'] },
    { group: '1D', id: 'gs1-128',  name: 'GS1-128 (EAN-128)',          bwip: 'gs1-128',          value: '(01)09506000134352(21)A4TEST', zxing: ['CODE_128'], detector: ['CODE_128'], note: 'Scans as Code 128; FNC1 shown as separator' },
    { group: '1D', id: 'ean13',    name: 'EAN-13',                     bwip: 'ean13',            value: '590123412345', zxing: ['EAN_13'],     detector: ['EAN_13'], checkDigit: true },
    { group: '1D', id: 'ean8',     name: 'EAN-8',                      bwip: 'ean8',             value: '7351353',      zxing: ['EAN_8'],      detector: ['EAN_8'], checkDigit: true },
    { group: '1D', id: 'upca',     name: 'UPC-A',                      bwip: 'upca',             value: '03600029145',  zxing: ['UPC_A', 'EAN_13'], detector: ['UPC_A', 'EAN_13'], checkDigit: true },
    { group: '1D', id: 'upce',     name: 'UPC-E',                      bwip: 'upce',             value: '01234565',     zxing: ['UPC_E', 'UPC_A', 'EAN_13'], detector: ['UPC_E', 'UPC_A', 'EAN_13'], note: 'Scanner may return UPC-A expansion' },
    { group: '1D', id: 'itf14',    name: 'ITF-14',                     bwip: 'itf14',            value: '1234567890123', zxing: ['ITF'],      detector: ['ITF'], checkDigit: true },
    { group: '1D', id: 'i2of5',    name: 'Interleaved 2 of 5',         bwip: 'interleaved2of5',  value: '1234567890',   zxing: ['ITF'],        detector: ['ITF'] },
    { group: '1D', id: 'codabar',  name: 'Codabar',                    bwip: 'rationalizedCodabar', value: 'A123456B',  zxing: ['CODABAR'],    detector: ['CODABAR'], note: 'Keep start/stop letters (A-D)' },
    { group: '1D', id: 'msi',      name: 'MSI (Plessey)',              bwip: 'msi',              value: '1234567',      zxing: [],             detector: [], note: 'No phone scanner support — visual check only' },
    { group: '1D', id: 'code11',   name: 'Code 11',                    bwip: 'code11',           value: '123-456',      zxing: [],             detector: [], note: 'No phone scanner support — visual check only' },
    { group: '1D', id: 'pharma',   name: 'Pharmacode (one-track)',     bwip: 'pharmacode',       value: '131070',       zxing: [],             detector: [], note: 'No phone scanner support — visual check only' },
    { group: '1D', id: 'telepen',  name: 'Telepen',                    bwip: 'telepen',          value: 'A4-PRINT',     zxing: ['TELEPEN'],    detector: [], note: 'Reads via zxing-cpp fallback scanner (not native BarcodeDetector)' },
    { group: '1D', id: 'databar',  name: 'GS1 DataBar Omnidirectional', bwip: 'databaromni',     value: '(01)09506000134352', zxing: ['DATA_BAR'],       detector: [], note: 'Reads via zxing-cpp fallback scanner (not native BarcodeDetector)' },
    // ---- 2D ----
    { group: '2D', id: 'qr',       name: 'QR Code',                    bwip: 'qrcode',           value: 'A4-PRINT-TEST-QR',    zxing: ['QR_CODE'],    detector: ['QR_CODE'] },
    { group: '2D', id: 'dm',       name: 'Data Matrix',                bwip: 'datamatrix',       value: 'A4-PRINT-TEST-DM',    zxing: ['DATA_MATRIX'], detector: ['DATA_MATRIX'] },
    { group: '2D', id: 'gs1dm',    name: 'GS1 Data Matrix',            bwip: 'gs1datamatrix',    value: '(01)09506000134352(21)A4TEST', zxing: ['DATA_MATRIX'], detector: ['DATA_MATRIX'], note: 'Scans as Data Matrix; FNC1 shown as separator' },
    { group: '2D', id: 'pdf417',   name: 'PDF417',                     bwip: 'pdf417',           value: 'A4-PRINT-TEST-PDF417', zxing: ['PDF_417'],   detector: ['PDF_417'] },
    { group: '2D', id: 'micropdf', name: 'MicroPDF417',                bwip: 'micropdf417',      value: 'A4-MP417',            zxing: ['MICRO_PDF_417'], detector: [], note: 'Reads via zxing-cpp fallback scanner (not native BarcodeDetector)' },
    { group: '2D', id: 'aztec',    name: 'Aztec Code',                 bwip: 'azteccode',        value: 'A4-PRINT-TEST-AZTEC', zxing: ['AZTEC'],      detector: ['AZTEC'] },
    { group: '2D', id: 'microqr',  name: 'Micro QR Code',              bwip: 'microqrcode',      value: 'A4TEST',              zxing: ['MICRO_QR'],   detector: [], note: 'Reads via zxing-cpp fallback scanner; native detectors usually can\'t' },
    { group: '2D', id: 'maxicode', name: 'MaxiCode',                   bwip: 'maxicode',         value: 'A4-PRINT-TEST-MAXI',  zxing: ['MAXICODE'],   detector: [], note: 'Reads via zxing-cpp fallback scanner (not native BarcodeDetector)', maxicode: true }
  ];

  window.SYMBOLOGIES = S;

  // GS1 mod-10 check digit (EAN-13, EAN-8, UPC-A, ITF-14).
  window.gs1CheckDigit = function (digits) {
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      const dist = digits.length - i; // 1 = rightmost
      sum += (+digits[i]) * (dist % 2 === 1 ? 3 : 1);
    }
    return String((10 - (sum % 10)) % 10);
  };
})();
