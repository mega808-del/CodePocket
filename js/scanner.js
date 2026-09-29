/* CodePocket 스캐너: 카메라 실시간 스캔 + 갤러리 이미지 파일 스캔
 * - 카메라: getUserMedia + ZXing MultiFormatReader (프레임 수동 주입 방식으로 카메라 정지 대응)
 * - 파일: createImageBitmap/canvas로 휘도 배열 생성 후 디코드
 * 전역: window.CodePocket.Scanner
 */
'use strict';

(function () {
  const CP = (window.CodePocket = window.CodePocket || {});

  const FORMATS = [
    'QR_CODE', 'EAN_13', 'EAN_8', 'UPC_A', 'UPC_E',
    'CODE_128', 'CODE_39', 'CODE_93', 'ITF', 'CODABAR',
    'DATA_MATRIX', 'AZTEC', 'PDF_417'
  ];

  function getZXing() {
    const Z = window.ZXing;
    if (!Z) return null;
    return Z;
  }

  function buildHints(Z) {
    const formats = [];
    for (const name of FORMATS) {
      if (Z.BarcodeFormat && Z.BarcodeFormat[name] !== undefined) {
        formats.push(Z.BarcodeFormat[name]);
      }
    }
    const hints = new Map();
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, formats);
    hints.set(Z.DecodeHintType.TRY_HARDER, true);
    return hints;
  }

  // RGBA(canvas getImageData) -> 그레이스케일 휘도 배열
  // (zxing-js RGBLuminanceSource는 Uint8 입력 시 픽셀당 1바이트 휘도로 해석)
  function rgbaToLuminance(data, width, height) {
    const lum = new Uint8ClampedArray(width * height);
    for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
      // BT.601 휘도 근사
      lum[i] = (data[p] * 306 + data[p + 1] * 601 + data[p + 2] * 117) >> 10;
    }
    return lum;
  }

  function decodeLuminance(Z, lum, width, height) {
    const src = new Z.RGBLuminanceSource(lum, width, height);
    const bmp = new Z.BinaryBitmap(new Z.HybridBinarizer(src));
    const reader = new Z.MultiFormatReader();
    reader.setHints(buildHints(Z));
    return reader.decode(bmp); // 실패 시 throw
  }

  // ---------- 파일(갤러리) 스캔 ----------
  async function scanFile(file) {
    const Z = getZXing();
    if (!Z) throw new Error('스캐너 라이브러리가 아직 로드되지 않았습니다.');
    if (!file) return null;

    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch (_) {
      // createImageBitmap 미지원 대체 경로
      const url = URL.createObjectURL(file);
      try {
        const img = await new Promise((resolve, reject) => {
          const i = new Image();
          i.onload = () => resolve(i);
          i.onerror = reject;
          i.src = url;
        });
        bitmap = img;
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    }

    const w = bitmap.width || bitmap.naturalWidth;
    const h = bitmap.height || bitmap.naturalHeight;
    if (!w || !h) throw new Error('이미지 크기를 읽을 수 없습니다.');

    // 너무 큰 이미지는 축소 (성능/메모리)
    const maxDim = 1600;
    const scale = Math.min(1, maxDim / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, cw, ch);
    if (bitmap.close) bitmap.close();

    const imgData = ctx.getImageData(0, 0, cw, ch);
    const lum = rgbaToLuminance(imgData.data, cw, ch);

    // 1차: 원본 방향
    try {
      const res = decodeLuminance(Z, lum, cw, ch);
      return normalizeResult(res);
    } catch (_) { /* 회전 재시도 */ }

    // 2차: 90/180/270도 회전 재시도 (사진 방향 문제 대응)
    for (const deg of [90, 180, 270]) {
      try {
        const rc = document.createElement('canvas');
        rc.width = deg % 180 === 0 ? cw : ch;
        rc.height = deg % 180 === 0 ? ch : cw;
        const rctx = rc.getContext('2d', { willReadFrequently: true });
        rctx.translate(rc.width / 2, rc.height / 2);
        rctx.rotate((deg * Math.PI) / 180);
        rctx.drawImage(canvas, -cw / 2, -ch / 2);
        const rd = rctx.getImageData(0, 0, rc.width, rc.height);
        const rl = rgbaToLuminance(rd.data, rc.width, rc.height);
        const res = decodeLuminance(Z, rl, rc.width, rc.height);
        return normalizeResult(res);
      } catch (_) { /* 다음 각도 */ }
    }
    return null; // 인식 실패
  }

  function normalizeResult(res) {
    const formatName = (() => {
      try { return ZXing_BarcodeName(res.getBarcodeFormat()); }
      catch (_) { return ''; }
    })();
    return {
      text: res.getText(),
      format: formatName
    };
  }

  function ZXing_BarcodeFormatName(fmt) { return ''; }
  void ZXing_BarcodeFormatName;

  // BarcodeFormat 숫자 -> 이름 (ZXing enum 역매핑)
  function ZXing_BarcodeName(fmt) {
    const Z = getZXing();
    if (!Z) return String(fmt);
    for (const k of Object.keys(Z.BarcodeFormat)) {
      if (Z.BarcodeFormat[k] === fmt) return k;
    }
    return String(fmt);
  }

  // ---------- 카메라 스캔 ----------
  const Camera = {
    stream: null,
    video: null,
    running: false,
    rafId: 0,
    reader: null,
    cooldownUntil: 0,

    async start(onResult, onError) {
      const Z = getZXing();
      if (!Z) { onError && onError(new Error('스캐너 라이브러리 로드 실패')); return; }

      this.onResult = onResult;
      this.onError = onError;

      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        });
      } catch (e) {
        onError && onError(e);
        return;
      }

      this.video = document.getElementById('camera-video');
      if (!this.video) return;
      this.video.srcObject = this.stream;
      try { await this.video.play(); } catch (_) { /* 자동재생 정책 - 사용자 탭 후 재생 */ }

      this.reader = new Z.MultiFormatReader();
      this.reader.setHints(buildHints(Z));
      this.running = true;

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      const tick = () => {
        if (!this.running) return;
        const v = this.video;
        if (v && v.readyState >= 2 && v.videoWidth > 0) {
          const now = Date.now();
          if (now >= this.cooldownUntil) {
            // 중앙 영역 위주로 다운스케일 스캔 (성능)
            const maxSide = 640;
            const scale = Math.min(1, maxSide / Math.max(v.videoWidth, v.videoHeight));
            const cw = Math.round(v.videoWidth * scale);
            const ch = Math.round(v.videoHeight * scale);
            if (canvas.width !== cw || canvas.height !== ch) {
              canvas.width = cw; canvas.height = ch;
            }
            try {
              ctx.drawImage(v, 0, 0, cw, ch);
              const img = ctx.getImageData(0, 0, cw, ch);
              const lum = rgbaToLuminance(img.data, cw, ch);
              try {
                const src = new Z.RGBLuminanceSource(lum, cw, ch);
                const bmp = new Z.BinaryBitmap(new Z.HybridBinarizer(src));
                const res = this.reader.decode(bmp);
                // 성공: 쿨다운 후 결과 전달 (연속 스캔 방지)
                this.cooldownUntil = now + 1200;
                this.onResult && this.onResult(normalizeResult(res));
              } catch (_) {
                this.reader.reset();
              }
            } catch (_) { /* 프레임 스킵 */ }
          }
        }
        this.rafId = requestAnimationFrame(tick);
      };
      this.rafId = requestAnimationFrame(tick);
    },

    stop() {
      this.running = false;
      cancelAnimationFrame(this.rafId);
      if (this.stream) {
        for (const track of this.stream.getTracks()) {
          try { track.stop(); } catch (_) {}
        }
        this.stream = null;
      }
      if (this.video) {
        try { this.video.pause(); } catch (_) {}
        this.video.srcObject = null;
      }
      this.reader = null;
    }
  };

  CP.Scanner = { scanFile, Camera, rgbaToLuminance, decodeLuminance };
})();
