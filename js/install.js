/* CodePocket 설치 관리: beforeinstallprompt(Android/Chromium), iOS Safari 안내, "다시 보지 않기" 저장
 * 핵심: beforeinstallprompt 를 스크립트 로드 즉시 캡처해 늦은 바인딩으로 설치가 안 되는 문제를 방지
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

  function refreshChip() {
    const chip = document.getElementById('btn-install');
    if (!chip) return;
    // 버튼은 작고 방해되지 않으므로 앱 설치 후(standalone)에만 숨김.
    // 과거 "다시 보지 않기" 플래그로 버튼이 영구 숨겨지던 문제를 방지하기 위해
    // localStorage 숨김 플래그는 더 이상 사용하지 않는다.
    if (isStandalone() || installed) {
      chip.classList.add('hidden');
      return;
    }
    chip.classList.remove('hidden');
  }

  // iOS 설치 안내 모달
  function showIosGuide() {
    CP.showModal({
      title: 'iPhone에 설치하기',
      msg: 'Safari에서 설치할 수 있어요.\n① 하단 공유 버튼(사각형+↑) 누르기\n② "홈 화면에 추가" 선택\n③ 우측 상단 "추가" 누르기',
      buttons: [
        { label: '닫기', class: 'btn-primary' }
      ]
    });
  }

  // 프롬프트가 아직 준비되지 않은 Chrome 환경 안내
  function showFallbackGuide() {
    if (secureIssue()) {
      CP.showModal({
        title: '지금은 설치할 수 없어요',
        msg: '앱 설치는 보안 연결(https) 주소에서만 가능합니다.\n주소창이 http:// 로 시작한다면 https 주소로 다시 접속해 주세요.',
        buttons: [{ label: '확인', class: 'btn-primary' }]
      });
      return;
    }
    CP.showModal({
      title: 'Chrome에서 설치하기',
      msg: '앱 설치 창이 준비되는 중일 수 있어요.\n바로 설치하려면:\n① 브라우저 우측 상단 메뉴(⋮) 열기\n② "앱 설치" 또는 "홈 화면에 추가" 선택',
      buttons: [
        {
          label: '다시 시도', class: 'btn-primary', onClick: () => {
            if (deferredPrompt) installClick();
            else CP.toast && CP.toast('아직 준비되지 않았어요. 몇 초 후 다시 눌러 주세요.');
          }
        },
        { label: '닫기', class: 'btn-secondary' }
      ]
    });
  }

  async function installClick() {
    if (isIOS()) {
      showIosGuide();
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
        }
      } catch (_) { /* 무시 */ }
      refreshChip();
      return;
    }
    showFallbackGuide();
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

    // 디스플레이 모드 변화 대응
    const mq = window.matchMedia('(display-mode: standalone)');
    mq.addEventListener && mq.addEventListener('change', refreshChip);

    try { refreshChip(); } catch (e) { console.warn('설치 칩 갱신 실패:', e); }
  }

  CP.Install = { init, refreshChip, isStandalone, isIOS };
})();
