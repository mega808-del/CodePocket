/* CodePocket 1D 바코드 인코더 (EAN-13 / EAN-8 / CODE128 / ITF / CODE39)
 * 저장된 데이터를 선명한 바코드로 다시 그리기 위한 자체 구현.
 * 전역: window.CodePocket.BarcodeEncoders
 *   encodeBarcodes(text) -> { format, modules } | null  (modules: 흰0/검1 배열)
 * 정합성은 test/barcodes.test.js에서 ZXing 디코딩으로 검증한다.
 */
'use strict';

(function () {
  const CP = (window.CodePocket = window.CodePocket || {});

  function bitsFrom(str) {
    return Array.from(str, Number);
  }

  // ---------- CODE 128 ----------
  // 표준 107 패턴(0..102 데이터, 103..105 시작, 106 정지). 숫자 = 바/공백 교대 너비.
  const C128 = [
    '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213',
    '221312','231212','112232','122132','122231','113222','123122','123221','223211','221132',
    '221231','213212','223112','312131','311222','321122','321221','312212','322112','322211',
    '212123','212321','232121','111323','131123','131321','112313','132113','132311','211313',
    '231113','231311','112133','112331','132131','113123','113321','133121','313121','211331',
    '231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
    '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214',
    '112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
    '111242','121142','121241','114212','124112','124211','411212','421112','421211','212141',
    '214121','412121','111143','111341','131141','114113','114311','411113','411311','113141',
    '114131','311141','411131','211412','211214','211232','2331112'
  ];
  const START_B = 104, START_C = 105, STOP = 106, CODE_B = 100, CODE_C = 99;

  function widthsToBits(w) {
    const out = [];
    let black = true;
    for (let k = 0; k < w.length; k++) {
      const n = w.charCodeAt(k) - 48;
      for (let i = 0; i < n; i++) out.push(black ? 1 : 0);
      black = !black;
    }
    return out;
  }

  function code128Encode(text) {
    const s = String(text);
    for (let k = 0; k < s.length; k++) {
      const c = s.charCodeAt(k);
      if (c < 32 || c > 126) return null; // CODE128(B/C)로 표현 불가
    }
    const isDig = (ch) => ch >= '0' && ch <= '9';
    const digitRun = (idx) => {
      let n = 0;
      while (idx + n < s.length && isDig(s[idx + n])) n++;
      return n;
    };

    const values = [];
    let i = 0;
    let mode = digitRun(0) >= 4 ? 'C' : 'B';
    values.push(mode === 'C' ? START_C : START_B);

    while (i < s.length) {
      if (mode === 'C') {
        if (digitRun(i) >= 2) {
          values.push(parseInt(s.slice(i, i + 2), 10));
          i += 2;
        } else {
          values.push(CODE_B); // C -> B 전환
          mode = 'B';
        }
      } else {
        if (digitRun(i) >= 4) {
          values.push(CODE_C); // B -> C 전환
          mode = 'C';
        } else {
          values.push(s.charCodeAt(i) - 32);
          i += 1;
        }
      }
    }

    // 체크섬: start 포함 가중합 (가중치 1..n), 이후 mod 103
    let sum = values[0];
    for (let k = 1; k < values.length; k++) sum += values[k] * k;
    values.push(sum % 103);
    values.push(STOP);

    const bits = [];
    for (const v of values) {
      const pat = C128[v];
      if (!pat) return null;
      const b = widthsToBits(pat);
      for (const x of b) bits.push(x);
    }
    return bits;
  }

  // ---------- EAN-13 / EAN-8 ----------
  const EAN_L = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
  const EAN_G = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
  const EAN_R = ['1110010','1100110','1101100','1000010','1011100','1001110','1010000','1000100','1001000','1110100'];
  // 첫 자리 숫자별 왼쪽 6자리 패턴(0=A/홀수, 1=G/짝수)
  const EAN13_PARITY = ['000000','001011','001101','001110','010011','011001','011100','010101','010110','011010'];

  function ean13Encode(text) {
    const digits = String(text).replace(/\D/g, '');
    let base;
    if (digits.length === 13) base = digits.slice(0, 12);
    else if (digits.length === 12) base = digits;
    else return null;

    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(base[i]) * (i % 2 === 0 ? 1 : 3);
    const check = (10 - (sum % 10)) % 10;
    if (digits.length === 13 && Number(digits[12]) !== check) return null;

    const parity = EAN13_PARITY[Number(base[0])];
    let bits = '101';
    for (let i = 1; i <= 6; i++) {
      bits += parity[i - 1] === '0' ? EAN_L[Number(base[i])] : EAN_G[Number(base[i])];
    }
    bits += '01010'; // 중앙 가드
    for (let i = 7; i <= 11; i++) bits += EAN_R[Number(base[i])];
    bits += EAN_R[check]; // 13번째 자리 = 체크섬
    bits += '101';
    return bitsFrom(bits);
  }

  function ean8Encode(text) {
    const digits = String(text).replace(/\D/g, '');
    let base;
    if (digits.length === 8) base = digits.slice(0, 7);
    else if (digits.length === 7) base = digits;
    else return null;

    let sum = 0;
    for (let i = 0; i < 7; i++) sum += Number(base[i]) * (i % 2 === 0 ? 3 : 1);
    const check = (10 - (sum % 10)) % 10;
    if (digits.length === 8 && Number(digits[7]) !== check) return null;

    let bits = '101';
    for (let i = 0; i < 4; i++) bits += EAN_L[Number(base[i])];
    bits += '01010';
    for (let i = 4; i <= 6; i++) bits += EAN_R[Number(base[i])];
    bits += EAN_R[check]; // 8번째 자리 = 체크섬
    bits += '101';
    return bitsFrom(bits);
  }

  // ---------- ITF (Interleaved 2 of 5) ----------
  // 숫자별 바 너비 패턴(1=좁, 2=넓). 데이터는 바(홀수 자리)/공백(짝수 자리) 교차.
  const ITF_PATTERNS = ['11221','21112','12112','22111','11212','21211','12211','11122','21121','12121'];

  function itfEncode(text) {
    let digits = String(text).replace(/\D/g, '');
    if (digits.length === 0 || digits.length > 40) return null;
    if (digits.length % 2 === 1) digits = '0' + digits; // 짝수화(디코딩 결과와 다를 수 있어 기본 체인에서는 미사용)

    const bits = [1, 0, 1, 0]; // 시작: 좁은 바/공백/바/공백
    for (let i = 0; i < digits.length; i += 2) {
      const b = ITF_PATTERNS[Number(digits[i])];
      const w = ITF_PATTERNS[Number(digits[i + 1])];
      if (!b || !w) return null;
      for (let k = 0; k < 5; k++) {
        for (let n = 0; n < (b[k] === '1' ? 1 : 2); n++) bits.push(1); // 바
        for (let n = 0; n < (w[k] === '1' ? 1 : 2); n++) bits.push(0); // 공백
      }
    }
    bits.push(1, 1, 0, 1); // 정지: 넓은 바, 좁은 공백, 좁은 바
    return bits;
  }

  // ---------- CODE 39 ----------
  // JsBarcode와 동일한 방식: 각 문자의 표준 10진 인코딩 값을 2진 모듈열로 변환.
  // (1=바, 0=공백, 넓:좁 = 3:1) 문자 사이 1모듈 공백.
  const C39_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%*';
  const C39_DEC = [
    20957, 29783, 23639, 30485, 20951, 29813, 23669, 20855, 29789, 23645,
    29975, 23831, 30533, 22295, 30149, 24005, 21623, 29981, 23837, 22301,
    30023, 23879, 30545, 22343, 30161, 24017, 21959, 30065, 23921, 22385,
    29015, 18263, 29141, 17879, 29045, 18293, 17783, 29021, 18269, 17477,
    17489, 17681, 20753, 35770
  ];
  const C39_PAT = {};
  for (let i = 0; i < C39_CHARS.length; i++) {
    C39_PAT[C39_CHARS[i]] = C39_DEC[i].toString(2);
  }

  function code39Encode(text) {
    const upper = String(text).toUpperCase();
    if (!/^[0-9A-Z\-. $/+%]*$/.test(upper)) return null;
    if (upper.length === 0) return null;

    let bin = C39_PAT['*'];
    for (const ch of upper) {
      bin += C39_PAT[ch] + '0'; // 문자 + 1모듈 갭
    }
    bin += C39_PAT['*'];
    return bitsFrom(bin);
  }

  // ---------- 공개 API ----------
  // 우선순위: EAN-13 -> EAN-8 -> CODE128(모든 인쇄 가능 ASCII 커버).
  // ITF/CODE39는 데이터 왜곡(패딩) 소지가 있어 개별 검증용으로 export만 한다.
  function encodeBarcodes(text) {
    const t = String(text || '').trim();
    if (!t) return null;
    const attempts = [
      ['EAN-13', ean13Encode],
      ['EAN-8', ean8Encode],
      ['CODE 128', code128Encode]
    ];
    for (const [fmt, fn] of attempts) {
      try {
        const bits = fn(t);
        if (bits && bits.length) return { format: fmt, modules: bits };
      } catch (_) { /* 다음 후보 */ }
    }
    return null;
  }

  CP.BarcodeEncoders = { encodeBarcodes, code128Encode, ean13Encode, ean8Encode, itfEncode, code39Encode };
})();
