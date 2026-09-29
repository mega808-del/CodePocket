/* CodePocket 설치 관리: beforeinstallprompt(Android/Chromium), iOS Safari 안내, 스킵 상태 저장
 * 전역: window.CodePocket.Install
 */
'use strict';

(function () {
  const CP = (window.CodePocket = window.CodePocket || {});
  const SKIP_KEY = 'cp_install_dismissed';

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

  function dismissed() {
    try { return localStorage.getItem(SKIP_KEY) === '1'; } catch (_) { return false; }
  }

  function setDismissed() {
    try { localStorage.setItem(SKIP_KEY, '1'); } catch (_) { /* 무시 */ }
  }

  // 이벤트: 설치 가능 여부 변화에 따라 카드 UI 갱신
  function refreshCard() {
    const card = document.getElementById('install-card');
    const btn = document.getElementById('btn-install');
    const hint = document.getElementById('install-hint');
    if (!card || !btn) return;

    if (isStandalone() || installed) {
      card.classList.add('hidden');
      return;
    }
    if (dismissed()) {
      card.classList.add('hidden');
      return;
    }
    card.classList.remove('hidden');

    if (isIOS()) {
      btn.textContent = '📲 설치 방법 보기 (iPhone)';
    } else if (deferredPrompt) {
      btn.textContent = '📲 앱으로 설치하기';
      hint && hint.classList.add('hidden');
    } else {
      btn.textContent = '📲 앱으로 설치하기';
      if (hint) {
        hint.textContent = '브라우저 메뉴(⋮)에서 "앱 설치" 또는 "홈 화면 추가"를 선택해도 됩니다.';
        hint.classList.remove('hidden');
      }
    }
  }

  // iOS 설치 안내 모달 (단계 목록을 메시지에 포함해 중복 삽입 방지)
  function showIosGuide() {
    CP.showModal({
      title: 'iPhone에 설치하기',
      msg: 'Safari에서: 1) 하단 공유 버튼(사각형+위 화살표) 누르기  2) "홈 화면에 추가" 선택  3) 우측 상단 "추가" 누르기',
      buttons: [{ label: '닫기', class: 'btn-primary' }]
    });
  }

  async function installClick() {
    if (isIOS()) {
      showIosGuide();
      return;
    }
    if (deferredPrompt) {
      deferredPrompt.prompt();
      try {
        const choice = await deferredPrompt.userChoice;
        if (choice && choice.outcome === 'accepted') installed = true;
      } catch (_) { /* 무시 */ }
      deferredPrompt = null;
      refreshCard();
      return;
    }
    // 프롬프트 불가 환경: 일반 안내
    CP.showModal({
      title: '앱으로 설치하기',
      msg: '브라우저 메뉴(⋮ 또는 ☰)에서 "앱 설치", "홈 화면에 추가"를 선택하면 홈 화면에서 앱처럼 실행할 수 있습니다.',
      buttons: [{ label: '확인', class: 'btn-primary' }]
    });
  }

  function init() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      refreshCard();
    });
    window.addEventListener('appinstalled', () => {
      installed = true;
      deferredPrompt = null;
      refreshCard();
      CP.toast && CP.toast('설치 완료! 홈 화면에서 실행하세요.');
    });

    const btn = document.getElementById('btn-install');
    btn && btn.addEventListener('click', installClick);

    const skip = document.getElementById('btn-skip');
    skip && skip.addEventListener('click', () => {
      setDismissed();
      refreshCard();
    });

    // 디스플레이 모드 변화 대응
    const mq = window.matchMedia('(display-mode: standalone)');
    mq.addEventListener && mq.addEventListener('change', refreshCard);

    try { refreshCard(); } catch (e) { console.warn('설치 카드 갱신 실패:', e); }
  }

  CP.Install = { init, isStandalone, isIOS, refreshCard };
})();
