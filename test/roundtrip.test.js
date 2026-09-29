// QRCode 생성 -> ZXing 디코딩 라운드트립 검증 (Node, canvas 없이)
// 실행: node test/roundtrip.test.js
//
// 참고: zxing-js RGBLuminanceSource는
//  - Int32Array 입력 시 0xRRGGBB 픽셀로 해석
//  - 그 외(Uint8 계열) 입력 시 픽셀당 1바이트 "휘도(luminance)" 배열로 해석
// 따라서 검은 모듈=0, 흰 모듈=255 인 그레이스케일 휘도 배열을 넣는다.
const fs = require('fs');
const path = require('path');

// --- 최소 DOM/canvas 스텁 (라이브러리가 참조하는 전역만 흉내) ---
if (typeof document === 'undefined') {
  global.document = { createElement() { return { getContext: () => null, style: {} }; } };
}
if (typeof navigator === 'undefined') {
  global.navigator = { userAgent: 'node' };
}

// --- 번들 로드: 간접 eval은 전역 스코프에서 실행되므로 QRCode / ZXing 전역이 노출됨 ---
const qrcodeSrc = fs.readFileSync(path.join(__dirname, '..', 'vendor', 'qrcode.min.js'), 'utf8');
const zxingSrc = fs.readFileSync(path.join(__dirname, '..', 'vendor', 'zxing.umd.min.js'), 'utf8');
(0, eval)(qrcodeSrc);
(0, eval)(zxingSrc);
const QRCode = globalThis.QRCode;
const ZXing = globalThis.ZXing;

if (!QRCode) { console.error('FAIL: QRCode 전역이 노출되지 않았습니다'); process.exit(1); }
if (!ZXing) { console.error('FAIL: ZXing 전역이 노출되지 않았습니다'); process.exit(1); }

let passed = 0, failed = 0;

// QR 모듈을 scale 배 확대하고 quiet zone(여백)을 둘러싼 휘도 배열 생성
function toLuminance(text, opts, scale, quiet) {
  const qr = QRCode.create(text, opts);
  const size = qr.modules.size;
  const data = qr.modules.data; // Uint8Array, 1=black
  const dim = (size + quiet * 2) * scale;
  const lum = new Uint8ClampedArray(dim * dim);
  for (let y = 0; y < dim; y++) {
    for (let x = 0; x < dim; x++) {
      const my = Math.floor(y / scale) - quiet;
      const mx = Math.floor(x / scale) - quiet;
      const black = mx >= 0 && my >= 0 && mx < size && my < size && data[my * size + mx];
      lum[y * dim + x] = black ? 0 : 255;
    }
  }
  return { lum, dim };
}

function decodeOnce(lum, dim, binarizerName) {
  const src = new ZXing.RGBLuminanceSource(lum, dim, dim);
  const bin = binarizerName === 'global'
    ? new ZXing.GlobalHistogramBinarizer(src)
    : new ZXing.HybridBinarizer(src);
  const bmp = new ZXing.BinaryBitmap(bin);
  const reader = new ZXing.MultiFormatReader();
  reader.setHints(new Map([
    [ZXing.DecodeHintType.POSSIBLE_FORMATS, [
      ZXing.BarcodeFormat.QR_CODE, ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8,
      ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.CODE_39, ZXing.BarcodeFormat.ITF,
      ZXing.BarcodeFormat.CODABAR, ZXing.BarcodeFormat.UPC_A
    ]],
    [ZXing.DecodeHintType.TRY_HARDER, true]
  ]));
  return reader.decode(bmp);
}

// 실제 스캔 상황(스케일/여백/바이너라이저 조합)을 순회하며 하나라도 성공하면 통과
function roundTrip(label, text, qrOpts) {
  for (const scale of [4, 2, 8]) {
    for (const quiet of [4, 2]) {
      try {
        const { lum, dim } = toLuminance(text, qrOpts || { errorCorrectionLevel: 'M' }, scale, quiet);
        for (const binName of ['hybrid', 'global']) {
          try {
            const result = decodeOnce(lum, dim, binName);
            if (result.getText() === text) {
              passed++;
              console.log(`PASS  ${label} (scale=${scale}, quiet=${quiet}, ${binName})`);
              return;
            }
            failed++;
            console.error(`FAIL  ${label}: 텍스트 불일치 "${result.getText()}"`);
            return;
          } catch (_) { /* 다음 조합 시도 */ }
        }
      } catch (e) {
        failed++;
        console.error(`FAIL  ${label}: 생성/변환 오류 ${e && e.message}`);
        return;
      }
    }
  }
  failed++;
  console.error(`FAIL  ${label}: 모든 조합에서 디코딩 실패`);
}

(() => {
  roundTrip('URL', 'https://example.com/hospital/12345');
  roundTrip('한글 텍스트', '서울종합병원 외래 접수 카드');
  roundTrip('숫자+기호', 'P-1234-LOT7 #A3');
  roundTrip('짧은 문자열', 'A1');
  roundTrip('긴 문자열(500자)', 'CodePocket-'.repeat(46));
  roundTrip('EC 레벨 H', ' PARKING LEVEL 3 SECTION B ', { errorCorrectionLevel: 'H' });
  console.log(`\n결과: ${passed} 통과, ${failed} 실패`);
  process.exit(failed ? 1 : 0);
})();
