/* CodePocket 설치 관리 (date 프로젝트 설치 기능 이식)
 * - beforeinstallprompt 캡처(스크립트 로드 즉시) → Android/Chrome 공식 설치 프롬프트
 * - iOS Safari: 단계별 설치 안내 모달
 * - 카카오톡·네이버 등 인앱 브라우저 감지 → intent:// 로 삼성인터넷/Chrome 전환
 * - 설치 후(standalone) 버튼 자동 숨김, "다시 보지 않기" 플래그는 사용하지 않음
 * 전역: window.CodePocket.Install
 */
'use strict';

(function () {
  const CP = (window.CodePocket = window.CodePocket || {});

  let deferredPrompt = null;
  let installed = false;

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
  }

  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      // iPadOS 13+ 데스크톱 UA 처리
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  // https(또는 localhost)가 아니면 Chrome 은 설치 이벤트를 아예 발생시키지 않음
  function secureIssue() {
    return !(window.isSecureContext ||
      location.hostname === 'localhost' || location.hostname === '127.0.0.1');
  }

  // ---------- 브라우저 환경 감지 (date 프로젝트 이식) ----------
  const UA = navigator.userAgent;
  const isAndroid = /Android/i.test(UA);
  // 카카오톡/네이버/다음/웨일 등 인앱 브라우저: 설치 프롬프트가 아예 동작하지 않음
  const isInAppBrowser = /KAKAOTALK|KakaoTalk/i.test(UA) || /inapp|NAVER|Daum|Whale/i.test(UA);

  // ---------- 전용 설치 모달 ----------
  function el(id) { return document.getElementById(id); }

  function showInstallModal() {
    const modal = el('install-modal');
    if (!modal) { CP.showModal && CP.showModal({ title: '앱 설치', msg: '브라우저 메뉴에서 "홈 화면에 추가"를 선택해 주세요.' }); return; }

    const desc = el('install-modal-desc');
    const steps = el('install-modal-steps');
    const ext = el('install-modal-ext');

    if (isAndroid && isInAppBrowser) {
      // 카카오톡 등 인앱 브라우저: 외부 브라우저 전환 버튼 제공
      desc.textContent = '카카오톡 등 앱 내부 브라우저에서는 앱 설치가 제한됩니다.\n아래 버튼으로 실제 브라우저에서 열어 설치해 주세요.';
      steps && steps.classList.add('hidden');
      ext && ext.classList.remove('hidden');
    } else if (isIOS()) {
      desc.textContent = 'Safari에서 간단한 3단계로 설치할 수 있어요.';
      steps && steps.classList.remove('hidden');
      ext && ext.classList.add('hidden');
    } else if (secureIssue()) {
      desc.textContent = '앱 설치는 보안 연결(https) 주소에서만 가능합니다.\n주소창이 http:// 로 시작한다면 https 주소로 다시 접속해 주세요.';
      steps && steps.classList.add('hidden');
      ext && ext.classList.add('hidden');
    } else {
      desc.textContent = '앱 설치 창이 준비되는 중일 수 있어요.\n바로 설치하려면 브라우저 메뉴(⋮)에서 "앱 설치" 또는 "홈 화면에 추가"를 선택해 주세요.';
      steps && steps.classList.add('hidden');
      ext && ext.classList.add('hidden');
    }
    modal.classList.remove('hidden');
  }

  function hideInstallModal() {
    const modal = el('install-modal');
    modal && modal.classList.add('hidden');
  }

  // 인앱 브라우저 → 실제 브라우저 전환: 삼성 인터넷 우선, Chrome 폴백 (date 프로젝트 이식)
  function openExternalBrowser() {
    hideInstallModal();
    const target = location.origin + location.pathname;
    const started = Date.now();
    const samsungIntent = 'intent://' + target.replace(/^https?:\/\//, '') +
      '#Intent;scheme=https;package=com.sec.android.app.sbrowser;end';
    const chromeIntent = 'intent://' + target.replace(/^https?:\/\//, '') +
      '#Intent;scheme=https;package=com.android.chrome;end';
    try {
      window.location.href = samsungIntent;
    } catch (_) {
      try { window.location.href = chromeIntent; } catch (_2) { window.location.href = target; }
      return;
    }
    // 1.5초 내 삼성 인터넷이 열리지 않으면 Chrome intent로 폴백
    const check = setInterval(() => {
      if (document.visibilityState === 'hidden') { clearInterval(check); return; } // 브라우저 전환 성공
      if (Date.now() - started > 1500) {
        clearInterval(check);
        try { window.location.href = chromeIntent; } catch (_3) { window.location.href = target; }
      }
    }, 200);
  }

  function refreshChip() {
    const chip = document.getElementById('btn-install');
    if (!chip) return;
    // 버튼은 작고 방해되지 않으므로 앱 설치 후(standalone)에만 숨김.
    if (isStandalone() || installed) {
      chip.classList.add('hidden');
      return;
    }
    chip.classList.remove('hidden');
  }

  async function installClick() {
    if (isIOS() || (isAndroid && isInAppBrowser)) {
      showInstallModal();
      return;
    }
    if (deferredPrompt) {
      const p = deferredPrompt;
      deferredPrompt = null; // 프롬프트는 1회용 — 중복 호출 방지
      try {
        p.prompt();
        const choice = await p.userChoice;
        if (choice && choice.outcome === 'accepted') {
          installed = true;
          CP.toast && CP.toast('설치를 진행합니다…');
        } else {
          deferredPrompt = p; // 사용자가 닫았으면 재시도 가능하도록 복구
        }
      } catch (_) {
        deferredPrompt = null;
        showInstallModal();
      }
      refreshChip();
      return;
    }
    showInstallModal();
  }

  // 스크립트 로드 즉시 이벤트 캡처 (init/DOMContentLoaded 이전 발생 대비)
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    try { refreshChip(); } catch (_) { /* DOM 미준비 시 무시 */ }
  });

  window.addEventListener('appinstalled', () => {
    installed = true;
    deferredPrompt = null;
    try { refreshChip(); } catch (_) { /* 무시 */ }
    CP.toast && CP.toast('설치 완료! 홈 화면에서 실행하세요.');
  });

  function init() {
    const chip = document.getElementById('btn-install');
    chip && chip.addEventListener('click', installClick);

    // 전용 설치 모달 닫기 / 외부 브라우저 전환 / Esc·배경 클릭
    const closeBtn = el('install-modal-close');
    closeBtn && closeBtn.addEventListener('click', hideInstallModal);
    const extBtn = el('install-open-browser');
    extBtn && extBtn.addEventListener('click', openExternalBrowser);
    const modal = el('install-modal');
    modal && modal.addEventListener('click', (e) => { if (e.target === modal) hideInstallModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideInstallModal(); });

    // 디스플레이 모드 변화 대응
    const mq = window.matchMedia('(display-mode: standalone)');
    mq.addEventListener && mq.addEventListener('change', refreshChip);

    try { refreshChip(); } catch (e) { console.warn('설치 칩 갱신 실패:', e); }
  }

  CP.Install = { init, refreshChip, isStandalone, isIOS, showInstallModal };
})();
