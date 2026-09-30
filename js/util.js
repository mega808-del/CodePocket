/* CodePocket 공용 유틸리티: 안전한 DOM 접근, 토스트, 모달, 포맷 표시, 밝기 제어 */
'use strict';

(function () {
  // ---------- 안전한 DOM 헬퍼 ----------
  const CP = (window.CodePocket = window.CodePocket || {});

  const $ = (sel) => document.querySelector(sel);

  function on(el, ev, fn, opt) {
    if (!el) return;
    if (el instanceof NodeList || Array.isArray(el)) {
      el.forEach((e) => e && e.addEventListener(ev, fn, opt));
    } else {
      el.addEventListener(ev, fn, opt);
    }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ---------- 날짜/시간 ----------
  function fmtDate(ts) {
    try {
      const d = new Date(ts);
      return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
    } catch (_) { return ''; }
  }

  // ---------- 포맷 이름 ----------
  const FORMAT_LABELS = {
    QR_CODE: 'QR 코드', EAN_13: 'EAN-13', EAN_8: 'EAN-8', UPC_A: 'UPC-A', UPC_E: 'UPC-E',
    CODE_128: 'CODE 128', CODE_39: 'CODE 39', CODE_93: 'CODE 93', ITF: 'ITF', CODABAR: 'CODABAR',
    DATA_MATRIX: 'Data Matrix', AZTEC: 'Aztec', PDF_417: 'PDF417'
  };
  const fmtLabel = (f) => FORMAT_LABELS[f] || (f || '코드');

  // ---------- 토스트 ----------
  let toastTimer = null;
  function toast(msg, ms) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms || 2200);
  }

  // ---------- 모달 (확인/안내) ----------
  function showModal({ title, msg, buttons }) {
    const backdrop = $('#modal');
    if (!backdrop) return;
    $('#modal-title').textContent = title || '안내';
    $('#modal-msg').textContent = msg || '';
    const box = $('#modal-buttons');
    box.innerHTML = '';
    (buttons || [{ label: '확인', class: 'btn-primary', value: true }]).forEach((b) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn ' + (b.class || 'btn-secondary');
      btn.style.marginTop = '8px';
      btn.textContent = b.label;
      on(btn, 'click', () => {
        backdrop.classList.add('hidden');
        if (b.onClick) b.onClick();
      });
      box.appendChild(btn);
    });
    backdrop.classList.remove('hidden');
  }

  function confirmModal(title, msg, onOk, okLabel) {
    showModal({
      title, msg,
      buttons: [
        { label: '취소', class: 'btn-secondary' },
        { label: okLabel || '삭제', class: 'btn-danger', onClick: onOk }
      ]
    });
  }

  // ---------- 화면 밝기 최대 ----------
  const Brightness = {
    active: false,
    wakeLock: null,
    prevStyle: '',
    async on() {
      if (this.active) return true;
      try {
        // 1) Wake Lock (화면 꺼짐 방지) - 지원 브라우저에서만
        if ('wakeLock' in navigator && navigator.wakeLock.request) {
          this.wakeLock = await navigator.wakeLock.request('screen').catch(() => null);
        }
      } catch (_) { /* 미지원 */ }
      // 2) 흰 화면 + 검은 코드만 남기는 CSS 오버레이 대신, 뷰어 스타일 교체
      const body = document.body;
      this.prevStyle = body.getAttribute('style') || '';
      body.setAttribute('style', this.prevStyle + ';background:#fff;');
      this.active = true;
      return true;
    },
    off() {
      if (this.wakeLock) { try { this.wakeLock.release(); } catch (_) {} this.wakeLock = null; }
      document.body.setAttribute('style', this.prevStyle);
      this.active = false;
    },
    async toggle() {
      if (this.active) this.off(); else await this.on();
      return this.active;
    }
  };
  document.addEventListener('visibilitychange', () => {
    // 화면 복귀 시 wake lock 재획득
    if (document.visibilityState === 'visible' && Brightness.active && Brightness.wakeLock === null) {
      Brightness.on().catch(() => {});
    }
  });

  // ---------- 복사 ----------
  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) { /* fallthrough */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch (_) { return false; }
  }

  // ---------- 다운로드 ----------
  function downloadBlob(blob, filename) {
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 400);
      return true;
    } catch (_) { return false; }
  }

  CP.$ = $;
  CP.on = on;
  CP.escapeHtml = escapeHtml;
  CP.fmtDate = fmtDate;
  CP.FORMAT_LABELS = FORMAT_LABELS;
  CP.fmtLabel = fmtLabel;
  CP.toast = toast;
  CP.showModal = showModal;
  CP.confirmModal = confirmModal;
  CP.Brightness = Brightness;
  CP.copyText = copyText;
  CP.downloadBlob = downloadBlob;
})();
