// 1D 바코드 인코더 -> ZXing 디코딩 검증 (Node)
// 실행: node test/barcodes.test.js
// 주의: 1D 리더는 픽셀에서 바 너비를 역산하므로, 모듈 1개를 여러 픽셀로 확대해 스캔라인을 만든다.
const fs = require('fs');
const path = require('path');

if (typeof document === 'undefined') {
  global.document = { createElement() { return { getContext: () => null, style: {} }; } };
}
if (typeof navigator === 'undefined') {
  global.navigator = { userAgent: 'node' };
}

// CodePocket 코드 로드 (window 스텁 필요)
global.window = global.window || global;
(0, eval)(fs.readFileSync(path.join(__dirname, '..', 'js', 'barcodes.js'), 'utf8'));
const { code128Encode, ean13Encode, ean8Encode, itfEncode, code39Encode } = global.window.CodePocket.BarcodeEncoders;

const zxingSrc = fs.readFileSync(path.join(__dirname, '..', 'vendor', 'zxing.umd.min.js'), 'utf8');
(0, eval)(zxingSrc);
const ZXing = globalThis.ZXing;

let passed = 0, failed = 0;

// 비트열(흰0/검1)을 1행짜리 휘도 이미지로 변환해 ZXing 1D 리더로 디코딩
// quiet zone: ZXing은 끝 가드 패턴 크기 이상의 여백을 요구하므로 4모듈 여백을 둔다 (실제 렌더러와 동일)
function decodeBits(bits, formatHints) {
  const SCALE = 3;
  const QUIET = SCALE * 4; // 4모듈 여백
  const width = bits.length * SCALE + QUIET * 2;
  const height = 12; // 1D 리더는 행 병합을 위해 약간의 높이 필요
  const lum = new Uint8ClampedArray(width * height).fill(255);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < bits.length * SCALE; x++) {
      if (bits[Math.floor(x / SCALE)]) lum[y * width + x + QUIET] = 0;
    }
  }
  const src = new ZXing.RGBLuminanceSource(lum, width, height);
  const bmp = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(src));
  const hints = new Map([
    [ZXing.DecodeHintType.POSSIBLE_FORMATS, formatHints],
    [ZXing.DecodeHintType.TRY_HARDER, true]
  ]);
  const reader = new ZXing.MultiFormatReader();
  reader.setHints(hints);
  return reader.decode(bmp); // 실패 시 throw
}

function check(label, text, bits, expectedFormat, formats) {
  try {
    const res = decodeBits(bits, formats);
    if (res.getText() === text && ZXing.BarcodeFormat[res.getBarcodeFormat()] === expectedFormat) {
      passed++;
      console.log(`PASS  ${label} -> ${res.getText()} (${expectedFormat})`);
    } else {
      failed++;
      console.error(`FAIL  ${label}: "${res.getText()}" / ${ZXing.BarcodeFormat[res.getBarcodeFormat()]} (기대: "${text}" / ${expectedFormat})`);
    }
  } catch (e) {
    failed++;
    console.error(`FAIL  ${label}: 디코딩 실패 - ${e && e.message}`);
  }
}

const ONE_D = [
  ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8, ZXing.BarcodeFormat.CODE_128,
  ZXing.BarcodeFormat.ITF, ZXing.BarcodeFormat.CODE_39
];

// --- EAN-13 ---
check('EAN-13', '5901234123457', ean13Encode('5901234123457'), 'EAN_13', [ZXing.BarcodeFormat.EAN_13]);
check('EAN-13(12자리+체크섬 계산)', '4006381333931', ean13Encode('400638133393'), 'EAN_13', [ZXing.BarcodeFormat.EAN_13]);

// --- EAN-8 ---
check('EAN-8', '96385074', ean8Encode('96385074'), 'EAN_8', [ZXing.BarcodeFormat.EAN_8]);

// --- CODE 128 ---
check('CODE128-B', 'HOSPITAL-A-12', code128Encode('HOSPITAL-A-12'), 'CODE_128', [ZXing.BarcodeFormat.CODE_128]);
check('CODE128-C', '12345678', code128Encode('12345678'), 'CODE_128', [ZXing.BarcodeFormat.CODE_128]);
check('CODE128 혼합', 'AB12cd34', code128Encode('AB12cd34'), 'CODE_128', [ZXing.BarcodeFormat.CODE_128]);

// --- ITF ---
check('ITF', '12345670', itfEncode('12345670'), 'ITF', [ZXing.BarcodeFormat.ITF]);

// --- CODE 39 ---
check('CODE39', 'CODE-39', code39Encode('CODE-39'), 'CODE_39', [ZXing.BarcodeFormat.CODE_39]);
check('CODE39 숫자', '2026', code39Encode('2026'), 'CODE_39', [ZXing.BarcodeFormat.CODE_39]);

// --- encodeBarcodes 체인 ---
const chain = global.window.CodePocket.BarcodeEncoders.encodeBarcodes;
const c1 = chain('5901234123457');
if (c1 && c1.format === 'EAN-13') { passed++; console.log('PASS  체인: EAN-13 우선 선택'); }
else { failed++; console.error('FAIL  체인: EAN-13 우선 선택 -', JSON.stringify(c1)); }

const c2 = chain('서울병원');
if (c2 === null) { passed++; console.log('PASS  체인: 인코딩 불가 텍스트 null 반환'); }
else { failed++; console.error('FAIL  체인: 인코딩 불가 텍스트가 null이 아님 -', JSON.stringify(c2)); }

const c3 = chain('P-1234');
if (c3 && c3.format === 'CODE 128') { passed++; console.log('PASS  체인: 일반 텍스트 CODE 128 선택'); }
else { failed++; console.error('FAIL  체인: 일반 텍스트 CODE 128 선택 -', JSON.stringify(c3)); }

console.log(`\n결과: ${passed} 통과, ${failed} 실패`);
process.exit(failed ? 1 : 0);
