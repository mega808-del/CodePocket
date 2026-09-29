/* CodePocket 메인: 부트스트랩과 전역 예외 방어 (흰 화면 방지) */
'use strict';

(function () {
  // ---------- 전역 예외 방어 ----------
  let errorShown = false;
  function showFatal() {
    if (errorShown) return;
    errorShown = true;
    const el = document.getElementById('fatal');
    if (el) el.classList.remove('hidden');
  }
  window.addEventListener('error', (e) => {
    console.error('전역 오류:', e && e.error || e.message);
  });
  window.addEventListener('unhandledrejection', (e) => {
    console.warn('처리되지 않은 Promise 거부:', e && e.reason);
  });

  function requireGlobal(name) {
    return window.CodePocket && window.CodePocket[name];
  }

  async function boot() {
    const CP = window.CodePocket;
    // DOM 렌더 후 실행 보장
    if (document.readyState === 'loading') {
      await new Promise((r) => document.addEventListener('DOMContentLoaded', r, { once: true }));
    }

    const missing = ['DB', 'Install', 'Scanner', 'Generator', 'UI'].filter((n) => !requireGlobal(n));
    if (missing.length) {
      console.error('모듈 로드 실패:', missing.join(', '));
      showFatal();
      return;
    }

    try {
      CP.Install.init();
    } catch (e) { console.warn('Install init 실패:', e); }

    try {
      CP.UI.init();
    } catch (e) {
      console.error('UI init 실패:', e);
      showFatal();
      return;
    }

    try {
      await CP.UI.reload();
    } catch (e) {
      console.warn('초기 로드 실패:', e);
    }

    // 데이터 관리(내보내기/가져오기/전체 삭제)는 콘솔/확장용으로 노출
    window.CodePocket.Tools = {
      export: CP.UI.exportData,
      import: CP.UI.importData,
      clearAll: CP.UI.requestClearAll
    };
  }

  boot().catch((e) => {
    console.error('부트 실패:', e);
    try { showFatal(); } catch (_) { /* 무시 */ }
  });
})();
