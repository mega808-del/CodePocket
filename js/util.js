/* CodePocket 공용 유틸리티: 안전한 DOM 접근, 토스트, 모달, 카테고리/포맷 표시, 밝기 제어 */
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

  // ---------- 카테고리 ----------
  // 기본 카테고리 (변경 금지: id가 저장 데이터의 category 값과 연결됨)
  const BASE_CATEGORIES = [
    { id: 'hospital', emoji: '🏥', label: '병원' },
    { id: 'office',   emoji: '🏢', label: '사무실' },
    { id: 'parking',  emoji: '🚗', label: '주차장' },
    { id: 'gym',      emoji: '💪', label: '헬스장' },
    { id: 'other',    emoji: '📦', label: '기타' }
  ];
  const ALL_ID = 'all';
  const ALL_CATEGORY = { id: ALL_ID, emoji: '🗂️', label: '전체' };

  // 사용자 정의 카테고리: localStorage에 저장 { id, emoji, label }
  const CUSTOM_KEY = 'cp_custom_categories';
  function loadCustomCategories() {
    try {
      const raw = localStorage.getItem(CUSTOM_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr
        .filter((c) => c && typeof c.id === 'string' && c.id && typeof c.label === 'string' && c.label)
        .map((c) => ({ id: c.id, emoji: c.emoji || '🏷️', label: String(c.label).slice(0, 8) }));
    } catch (_) { return []; }
  }
  function saveCustomCategories(list) {
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); } catch (_) { /* 무시 */ }
  }

  const CATEGORIES = [ALL_CATEGORY, ...BASE_CATEGORIES, ...loadCustomCategories()];
  const DEFAULT_CATEGORIES = CATEGORIES;
  const catById = (id) => CATEGORIES.find((c) => c.id === id) || CATEGORIES[CATEGORIES.length - 1];

  // 카테고리 순서 관리: 사용 빈도 + 수동 이동 순위를 localStorage에 저장
  // shape: { order: [id...], counts: { id: n } }
  const ORDER_KEY = 'cp_category_order';
  function loadOrderState() {
    try {
      const raw = localStorage.getItem(ORDER_KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj && Array.isArray(obj.order)) return obj;
      }
    } catch (_) { /* 무시 */ }
    return { order: CATEGORIES.slice(1).map((c) => c.id), counts: {} };
  }
  function saveOrderState(st) {
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(st)); } catch (_) { /* 무시 */ }
  }

  // 칩 표시 순서: [전체] -> [사용자가 올린 순위] -> [나머지는 사용 빈도 내림차순]
  function getOrderedCategories() {
    const st = loadOrderState();
    const pinned = st.order.filter((id) => CATEGORIES.some((c) => c.id === id));
    const rest = CATEGORIES
      .filter((c) => c.id !== ALL_ID && !pinned.includes(c.id))
      .slice()
      .sort((a, b) => (st.counts[b.id] || 0) - (st.counts[a.id] || 0));
    return [ALL_CATEGORY]
      .concat(pinned.map((id) => CATEGORIES.find((c) => c.id === id)))
      .concat(rest);
  }

  function getCategoryCount(id) {
    return loadOrderState().counts[id] || 0;
  }

  // 카테고리 선택 시 호출: 빈도 +1 (순위 재정렬은 하지 않음 - 수동 순위 우선)
  function bumpCategoryCount(id) {
    if (id === 'all') return;
    const st = loadOrderState();
    st.counts[id] = (st.counts[id] || 0) + 1;
    saveOrderState(st);
  }

  // 순서 편집: id를 위/아래로 한 칸 이동 (pinned 목록 내에서)
  function moveCategory(id, dir) {
    const st = loadOrderState();
    if (!st.order.includes(id)) st.order.push(id);
    const idx = st.order.indexOf(id);
    const to = idx + dir;
    if (to < 0 || to >= st.order.length) return false;
    [st.order[idx], st.order[to]] = [st.order[to], st.order[idx]];
    saveOrderState(st);
    return true;
  }

  // id를 pinned 맨 앞으로 올림 (가장 많이 쓰는 곳을 위로: 한 번 클릭으로 최상위 고정)
  function pinCategoryTop(id) {
    const st = loadOrderState();
    st.order = [id, ...st.order.filter((x) => x !== id)];
    saveOrderState(st);
  }

  function resetCategoryOrder() {
    try { localStorage.removeItem(ORDER_KEY); } catch (_) { /* 무시 */ }
  }

  // ---------- 사용자 정의 카테고리 추가/삭제 ----------
  function addCustomCategory(label, emoji) {
    const clean = String(label || '').trim().slice(0, 8);
    if (!clean) return null;
    // 이름 중복 방지 (기본 + 사용자 정의, 대소문자 무시)
    if (CATEGORIES.some((c) => c.label.toLowerCase() === clean.toLowerCase())) return null;
    const cat = {
      id: 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      emoji: emoji || '🏷️',
      label: clean
    };
    const list = loadCustomCategories();
    list.push(cat);
    saveCustomCategories(list);
    CATEGORIES.push(cat); // 현재 세션에도 즉시 반영
    return cat;
  }

  function removeCustomCategory(id) {
    const list = loadCustomCategories();
    const idx = list.findIndex((c) => c.id === id);
    if (idx < 0) return false;
    list.splice(idx, 1);
    saveCustomCategories(list);
    const cIdx = CATEGORIES.findIndex((c) => c.id === id);
    if (cIdx >= 0) CATEGORIES.splice(cIdx, 1);
    // 순서 데이터에서도 제거
    const st = loadOrderState();
    st.order = st.order.filter((x) => x !== id);
    delete st.counts[id];
    saveOrderState(st);
    return true;
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
        { label: okLabel || '삭제', class: 'btn-danger', onClick: onOk },
        { label: '취소', class: 'btn-secondary' }
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
  CP.CATEGORIES = CATEGORIES;
  CP.BASE_CATEGORIES = BASE_CATEGORIES;
  CP.loadCustomCategories = loadCustomCategories;
  CP.addCustomCategory = addCustomCategory;
  CP.removeCustomCategory = removeCustomCategory;
  CP.catById = catById;
  CP.getOrderedCategories = getOrderedCategories;
  CP.getCategoryCount = getCategoryCount;
  CP.bumpCategoryCount = bumpCategoryCount;
  CP.moveCategory = moveCategory;
  CP.pinCategoryTop = pinCategoryTop;
  CP.resetCategoryOrder = resetCategoryOrder;
  CP.FORMAT_LABELS = FORMAT_LABELS;
  CP.fmtLabel = fmtLabel;
  CP.toast = toast;
  CP.showModal = showModal;
  CP.confirmModal = confirmModal;
  CP.Brightness = Brightness;
  CP.copyText = copyText;
  CP.downloadBlob = downloadBlob;
})();
