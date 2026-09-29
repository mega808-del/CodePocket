// CodePocket 앱 아이콘 생성 스크립트 (QR 코드 모티프, 간결한 디자인)
// 실행: node scripts/make-icons.js
// 외부 패키지 없이 동작: 최소 PNG 인코더(zlib + CRC32)를 내장.
//
// 생성물 (assets/icons/):
//   icon-192.png, icon-512.png, icon-maskable-192.png, icon-maskable-512.png,
//   apple-touch-icon.png(180), favicon-32.png
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------- 최소 PNG writer ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  // filter 0 (None) 스캔라인
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  const src = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    src.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ---------- 아이콘 렌더링 ----------
const NAVY_TOP = [17, 68, 138];    // #11448A (상단)
const NAVY_BOTTOM = [10, 44, 91];  // #0A2C5B (하단)

// 고정 시드 난수 (매 실행 같은 아이콘)
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function renderIcon(size, { maskable = false } = {}) {
  const px = new Uint8ClampedArray(size * size * 4);
  const rng = mulberry32(20260928);

  // 배경: 위->아래 그라데이션
  const bgAt = (y) => {
    const t = size > 1 ? y / (size - 1) : 0;
    return [
      Math.round(NAVY_TOP[0] + (NAVY_BOTTOM[0] - NAVY_TOP[0]) * t),
      Math.round(NAVY_TOP[1] + (NAVY_BOTTOM[1] - NAVY_TOP[1]) * t),
      Math.round(NAVY_TOP[2] + (NAVY_BOTTOM[2] - NAVY_TOP[2]) * t)
    ];
  };
  for (let y = 0; y < size; y++) {
    const c = bgAt(y);
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
    }
  }

  const put = (x, y, white) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    if (white) {
      px[i] = 255; px[i + 1] = 255; px[i + 2] = 255; px[i + 3] = 255;
    } else {
      const c = bgAt(y);
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
    }
  };

  // QR 본체: 14x14 모듈 격자 (파인더 7 + 여백/데이터 7)
  const contentRatio = maskable ? 0.56 : 0.64; // maskable은 안전영역 확보
  const content = Math.floor(size * contentRatio);
  const margin = Math.floor((size - content) / 2);
  const cell = Math.max(1, Math.floor(content / 14));

  // 파인더 패턴 3개 (좌상/우상/좌하), 각 7x7 모듈
  const drawFinderAt = (gx, gy) => {
    for (let dy = 0; dy < 7; dy++) {
      for (let dx = 0; dx < 7; dx++) {
        const on = (dx === 0 || dx === 6 || dy === 0 || dy === 6) ||
                   (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4);
        for (let sy = 0; sy < cell; sy++) {
          for (let sx = 0; sx < cell; sx++) {
            put(margin + (gx + dx) * cell + sx, margin + (gy + dy) * cell + sy, on);
          }
        }
      }
    }
  };
  drawFinderAt(0, 0);
  drawFinderAt(7, 0);
  drawFinderAt(0, 7);

  // 데이터 모듈: 파인더가 없는 자리에 드문드문 흰 점
  const inFinder = (gx, gy) =>
    (gx < 7 && gy < 7) || (gx >= 7 && gy < 7) || (gx < 7 && gy >= 7);
  for (let gy = 0; gy < 14; gy++) {
    for (let gx = 0; gx < 14; gx++) {
      if (inFinder(gx, gy)) continue;
      if (rng() < 0.35) {
        for (let sy = 0; sy < cell; sy++) {
          for (let sx = 0; sx < cell; sx++) {
            put(margin + gx * cell + sx, margin + gy * cell + sy, true);
          }
        }
      }
    }
  }

  // 오른쪽 아래 "포켓" 문양: 흰 사각 노치 + 배경색 안쪽 사각
  const notch = Math.max(cell * 3, Math.floor(size * 0.2));
  const nx = size - margin - notch;
  const ny = size - margin - notch;
  for (let y = 0; y < notch; y++) {
    for (let x = 0; x < notch; x++) {
      const inner = x > notch * 0.3 && x < notch * 0.7 && y > notch * 0.3 && y < notch * 0.7;
      put(nx + x, ny + y, !inner);
    }
  }

  return px;
}

// ---------- 출력 ----------
const outDir = path.join(__dirname, '..', 'assets', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const targets = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-192.png', 192, true],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, false],
  ['favicon-32.png', 32, false]
];

for (const [name, size, maskable] of targets) {
  const px = renderIcon(size, { maskable });
  fs.writeFileSync(path.join(outDir, name), encodePng(size, size, px));
  console.log('생성:', name, `${size}x${size}`);
}
console.log('완료');
