/* CodePocket 생성기: 저장된 데이터에서 QR/바코드를 canvas에 선명하게 재생성
 * 전역: window.CodePocket.Generator
 *   drawCode(canvas, { type:'qr'|'barcode', value, format }) -> Promise<boolean>
 */
'use strict';

(function () {
  const CP = (window.CodePocket = window.CodePocket || {});

  const WHITE = '#ffffff';
  const BLACK = '#1a1a1a';

  function setupCanvas(canvas, width, height) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    // 캔버스 해상도는 크게, CSS 표시는 뷰어에서 제어
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = WHITE;
    ctx.fillRect(0, 0, width, height);
    return ctx;
  }

  // ---------- QR ----------
  async function drawQR(canvas, text, opts) {
    if (!window.QRCode || typeof window.QRCode.create !== 'function') {
      throw new Error('QR 생성 라이브러리가 로드되지 않았습니다.');
    }
    const qr = window.QRCode.create(text, {
      errorCorrectionLevel: opts && opts.ecl ? opts.ecl : 'M'
    });
    const size = qr.modules.size;
    const data = qr.modules.data;

    const quiet = 4; // 모듈 4개 여백
    const modulePx = Math.max(4, Math.floor(660 / (size + quiet * 2))); // 선명도 위해 충분히 크게
    const dim = (size + quiet * 2) * modulePx;

    const ctx = setupCanvas(canvas, dim, dim);
    ctx.fillStyle = BLACK;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (data[y * size + x]) {
          ctx.fillRect(
            (x + quiet) * modulePx,
            (y + quiet) * modulePx,
            modulePx, modulePx
          );
        }
      }
    }
    return true;
  }

  // ---------- 바코드 ----------
  function drawBarcode(canvas, value, formatName) {
    const enc = CP.BarcodeEncoders;
    let bits = null;

    if (enc) {
      if (formatName === 'EAN-13') bits = enc.ean13Encode(value);
      else if (formatName === 'EAN-8') bits = enc.ean8Encode(value);
      else if (formatName === 'ITF') bits = enc.itfEncode(value);
      else if (formatName === 'CODE 39') bits = enc.code39Encode(value);
      if (!bits) bits = enc.code128Encode(value);
      if (!bits) bits = (enc.encodeBarcodes(value) || {}).modules || null;
    }
    if (!bits) return false;

    const quietModules = 20; // 1D 여백은 모듈 폭 기준 넉넉히
    const totalUnits = bits.length + quietModules * 2;
    const unit = Math.max(2, Math.floor(1000 / totalUnits));
    const width = totalUnits * unit;
    const height = Math.max(120, Math.round(width * 0.22)); // 바코드 비율

    const ctx = setupCanvas(canvas, width, height);
    ctx.fillStyle = BLACK;
    for (let i = 0; i < bits.length; i++) {
      if (bits[i]) {
        ctx.fillRect((i + quietModules) * unit, 0, unit, height);
      }
    }
    return true;
  }

  // ---------- 공개 API ----------
  async function drawCode(canvas, code) {
    if (!canvas || !code || !code.value) return false;
    try {
      if (code.type === 'qr') {
        return await drawQR(canvas, code.value, {});
      }
      return drawBarcode(canvas, code.value, code.format);
    } catch (e) {
      console.warn('코드 생성 실패:', e);
      return false;
    }
  }

  // 카드 썸네일용 소형 렌더 (data URL)
  async function thumbDataUrl(code, size) {
    const c = document.createElement('canvas');
    const ok = await drawCode(c, code);
    if (!ok) return null;
    const target = size || 96;
    const out = document.createElement('canvas');
    out.width = target; out.height = target;
    const octx = out.getContext('2d');
    octx.fillStyle = WHITE;
    octx.fillRect(0, 0, target, target);
    // 정방형 맞춤(1D는 가로 중심, QR은 꽉 채움)
    const ratio = Math.min(target / c.width, target / c.height);
    const w = c.width * ratio, h = c.height * ratio;
    octx.drawImage(c, (target - w) / 2, (target - h) / 2, w, h);
    try { return out.toDataURL('image/png'); } catch (_) { return null; }
  }

  CP.Generator = { drawCode, drawQR, drawBarcode, thumbDataUrl };
})();
