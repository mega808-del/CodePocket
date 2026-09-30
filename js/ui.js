/* CodePocket UI: 화면 전환, 목록 렌더, 에디터·카메라·뷰어 흐름, ⋮ 메뉴, 내보내기/가져오기 */
'use strict';

(function () {
  const CP = (window.CodePocket = window.CodePocket || {});
  const $ = CP.$, on = CP.on, toast = CP.toast;

  const state = {
    codes: [],
    search: '',
    editingId: null,        // 수정 중인 코드 id
    scannedValue: null,     // 자동 인식 결과
    scannedFormat: '',
    currentViewId: null,    // 뷰어에 열려 있는 코드
    viewerBright: false
  };

  // ---------- 화면 전환 ----------
  function openSubview(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('open');
    el.setAttribute('aria-hidden', 'false');
  }
  function closeSubview(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('open');
    el.setAttribute('aria-hidden', 'true');
    if (id === 'view-camera') CP.Scanner.Camera.stop();
    if (id === 'view-viewer' && CP.Brightness.active) {
      CP.Brightness.off();
      state.viewerBright = false;
      syncBrightBtn();
    }
  }

  // ---------- 목록 ----------
  function visibleCodes() {
    const q = state.search.trim().toLowerCase();
    return state.codes
      .filter((c) => {
        if (!q) return true;
        return (c.name || '').toLowerCase().includes(q) ||
               (c.memo || '').toLowerCase().includes(q) ||
               (c.value || '').toLowerCase().includes(q);
      })
      .sort((a, b) => b.createdAt - a.createdAt); // 기본 정렬: 최근 등록순 (새 코드가 맨 위)
  }

  // 카드 종류 표시: "QR CODE" / "BARCODE"
  function typeTag(c) {
    if (c.type === 'barcode') return 'BARCODE';
    // 2D 코드(QR 외 Data Matrix/Aztec 등)도 관습적으로 QR CODE로 표기
    return 'QR CODE';
  }

  function renderList() {
    const list = document.getElementById('code-list');
    const empty = document.getElementById('empty-state');
    if (!list || !empty) return;
    const items = visibleCodes();
    list.innerHTML = '';
    empty.classList.toggle('hidden', items.length > 0);

    for (const c of items) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'code-card';
      card.dataset.id = c.id;

      // 실제 QR/바코드 미리보기 (비동기 생성, 실패 시 유형 글자 표시)
      const thumb = document.createElement('span');
      thumb.className = 'thumb';
      thumb.innerHTML = `<span class="thumb-glyph">${c.type === 'qr' ? '▦' : '▥'}</span>`;
      CP.Generator.thumbDataUrl(c, 168).then((url) => {
        if (!url || !thumb.isConnected) return;
        thumb.innerHTML = `<img src="${url}" alt="" />`;
      }).catch(() => { /* 글자 표시 유지 */ });

      const info = document.createElement('span');
      info.className = 'info';
      info.innerHTML =
        `<span class="name">${CP.escapeHtml(c.name)}${c.favorite ? ' <span class="star">★</span>' : ''}</span>` +
        `<span class="kind">${typeTag(c)}</span>`;

      // ⋮ 옵션 메뉴 버튼
      const menuBtn = document.createElement('span');
      menuBtn.className = 'menu-btn';
      menuBtn.setAttribute('role', 'button');
      menuBtn.setAttribute('aria-label', `${c.name} 옵션 메뉴`);
      menuBtn.setAttribute('aria-haspopup', 'menu');
      menuBtn.textContent = '⋮';
      on(menuBtn, 'click', (e) => {
        e.stopPropagation();
        openCardMenu(c);
      });
      // 카드(=button) 안의 span 클릭이 카드 클릭으로 전파되지 않게 처리
      on(menuBtn, 'pointerdown', (e) => e.stopPropagation());

      card.appendChild(thumb);
      card.appendChild(info);
      card.appendChild(menuBtn);
      on(card, 'click', () => openViewer(c.id));
      list.appendChild(card);
    }
  }

  // ---------- 카드 ⋮ 메뉴 ----------
  function closeCardMenu() {
    const sheet = document.getElementById('menu-sheet');
    const backdrop = document.getElementById('menu-backdrop');
    if (sheet) sheet.classList.add('hidden');
    if (backdrop) backdrop.classList.add('hidden');
  }

  function openCardMenu(c) {
    const sheet = document.getElementById('menu-sheet');
    const backdrop = document.getElementById('menu-backdrop');
    const title = document.getElementById('menu-title');
    if (!sheet || !backdrop) return;

    if (title) title.textContent = c.name || '이름 없는 코드';

    const items = [
      { icon: '✏️', label: '이름 수정', fn: () => openRenameModal(c) },
      { icon: '🔧', label: '코드 수정', fn: async () => {
          const code = await safeGetCode(c.id);
          if (code) openEditor(code);
        } },
      { icon: c.favorite ? '☆' : '★', label: c.favorite ? '즐겨찾기 해제' : '즐겨찾기', fn: () => toggleFavorite(c) },
      { icon: '🔍', label: '크게 보기', fn: () => openViewer(c.id) },
      { icon: '🗑️', label: '삭제', danger: true, fn: () => confirmDeleteCode(c) }
    ];

    const box = document.getElementById('menu-items');
    box.innerHTML = '';
    for (const it of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'menu-item' + (it.danger ? ' danger' : '');
      b.innerHTML = `<span class="mi-icon">${it.icon}</span><span>${CP.escapeHtml(it.label)}</span>`;
      on(b, 'click', () => {
        closeCardMenu();
        it.fn();
      });
      box.appendChild(b);
    }

    backdrop.classList.remove('hidden');
    sheet.classList.remove('hidden');
  }

  async function safeGetCode(id) {
    try {
      return await CP.DB.getCode(id);
    } catch (_) {
      toast('항목을 불러오지 못했습니다.');
      return null;
    }
  }

  // ---------- 이름 수정 모달 ----------
  function openRenameModal(c) {
    const modal = document.getElementById('rename-modal');
    const input = document.getElementById('rename-input');
    if (!modal || !input) return;
    input.value = c.name || '';
    modal.classList.remove('hidden');
    modal.dataset.id = c.id;
    setTimeout(() => { input.focus(); input.select(); }, 60);
  }

  function closeRenameModal() {
    const modal = document.getElementById('rename-modal');
    if (modal) modal.classList.add('hidden');
  }

  async function submitRename() {
    const modal = document.getElementById('rename-modal');
    const input = document.getElementById('rename-input');
    if (!modal || !input) return;
    const id = modal.dataset.id;
    const name = input.value.trim();
    if (!name) { toast('이름을 입력해 주세요.'); input.focus(); return; }
    try {
      await CP.DB.updateCode(id, { name });
      closeRenameModal();
      await reload();
      flashCard(id);
      toast('이름을 수정했습니다.');
    } catch (_) {
      toast('이름 수정에 실패했습니다.');
    }
  }

  // ---------- 삭제 ----------
  function confirmDeleteCode(c) {
    CP.confirmModal(
      '코드 삭제',
      `'${c.name || '이름 없는 코드'}'를 삭제하시겠습니까?\n삭제하면 복구할 수 없습니다.`,
      async () => {
        try {
          await CP.DB.deleteCode(c.id);
          await reload();
          toast('삭제했습니다.');
        } catch (_) {
          toast('삭제에 실패했습니다.');
        }
      },
      '삭제'
    );
  }

  async function reload() {
    try {
      state.codes = await CP.DB.listCodes();
    } catch (e) {
      console.warn('목록 로드 실패:', e);
      state.codes = [];
      toast('데이터 로드에 실패했습니다. 새로고침해 주세요.');
    }
    renderList();
  }

  async function toggleFavorite(c) {
    try {
      await CP.DB.setFavorite(c.id, !c.favorite);
      c.favorite = !c.favorite;
      renderList();
      toast(c.favorite ? '즐겨찾기에 추가했습니다.' : '즐겨찾기를 해제했습니다.');
    } catch (_) {
      toast('처리에 실패했습니다.');
    }
  }

  // ---------- 카드 하이라이트 & 맨 위로 ----------
  // 저장 직후 방금 카드로 스크롤하고 잠깐 빛나는 효과를 준다
  function flashCard(id) {
    requestAnimationFrame(() => {
      const card = [...document.querySelectorAll('.code-card')].find((el) => el.dataset.id === id);
      if (!card) return;
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('just-saved');
      setTimeout(() => card.classList.remove('just-saved'), 2400);
    });
  }

  // 목록 맨 위로: 스크롤이 내려가면 표시되는 떠 있는 버튼
  function setupScrollTop() {
    const btn = document.getElementById('btn-scroll-top');
    if (!btn) return;
    const toggle = () => {
      btn.classList.toggle('hidden', window.scrollY < 320);
    };
    window.addEventListener('scroll', toggle, { passive: true });
    toggle();
  }

  function goToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const first = document.querySelector('.code-card');
    if (first) {
      first.classList.add('just-saved');
      setTimeout(() => first.classList.remove('just-saved'), 1600);
    }
  }

  // ---------- 에디터 ----------
  function resetEditor() {
    state.editingId = null;
    state.scannedValue = null;
    state.scannedFormat = '';
    $('#inp-value').value = '';
    $('#inp-name').value = '';
    $('#inp-memo').value = '';
    document.getElementById('scan-badge').classList.add('hidden');
    setTypeSeg('qr');
    clearPreview();
  }

  function setTypeSeg(type) {
    document.querySelectorAll('#type-seg button').forEach((b) => {
      b.classList.toggle('active', b.dataset.type === type);
    });
  }
  function currentType() {
    const active = document.querySelector('#type-seg button.active');
    return active ? active.dataset.type : 'qr';
  }

  function clearPreview() {
    $('#preview-canvas').classList.add('hidden');
    $('#preview-empty').classList.remove('hidden');
    const c = $('#preview-canvas');
    c.width = 10; c.height = 10;
  }

  async function refreshPreview() {
    const value = $('#inp-value').value.trim();
    const canvas = $('#preview-canvas');
    if (!value) { clearPreview(); return; }
    const ok = await CP.Generator.drawCode(canvas, { type: currentType(), value, format: state.scannedFormat });
    if (ok) {
      canvas.classList.remove('hidden');
      $('#preview-empty').classList.add('hidden');
    } else {
      clearPreview();
      $('#preview-empty').innerHTML = '입력한 내용으로 코드를 만들 수 없습니다.<br />내용을 확인해 주세요.';
      $('#preview-empty').classList.remove('hidden');
    }
  }

  async function openEditor(code) {
    resetEditor();
    if (code) {
      state.editingId = code.id;
      $('#editor-title').textContent = '코드 수정';
      $('#inp-value').value = code.value;
      $('#inp-name').value = code.name || '';
      $('#inp-memo').value = code.memo || '';
      setTypeSeg(code.type);
      state.scannedValue = code.value;
      state.scannedFormat = code.format || '';
      if (state.scannedFormat) document.getElementById('scan-badge').classList.remove('hidden');
      refreshPreview();
    } else {
      $('#editor-title').textContent = '코드 추가';
    }
    openSubview('view-editor');
  }

  // 이름 미입력 시 유형으로 자동 이름 생성 (예: "QR 코드", "바코드 2")
  function autoName(type) {
    const base = type === 'barcode' ? '바코드' : 'QR 코드';
    const sameType = state.codes.filter((c) => (c.name || '').startsWith(base)).length;
    return sameType > 0 ? `${base} ${sameType + 1}` : base;
  }

  async function saveFromEditor() {
    // 모바일: 입력 중(포커스+소프트 키보드) 저장 버튼이 흔들려 클릭이 무효화되는 문제 방지
    // 클릭이 성공한 시점이므로 이후 로직은 안전하게 진행된다.
    const value = $('#inp-value').value.trim();
    if (!value) { toast('코드 내용을 입력하거나 스캔해 주세요.'); return; }
    const name = $('#inp-name').value.trim() || autoName(currentType());

    const data = {
      value,
      name,
      memo: $('#inp-memo').value.trim(),
      type: currentType(),
      format: state.scannedFormat,
      photoDataUrl: state.editingId ? undefined : (editorPhotoDataUrl || null)
    };

    try {
      if (state.editingId) {
        await CP.DB.updateCode(state.editingId, data);
        toast('수정했습니다.');
      } else {
        await CP.DB.addCode(data);
        toast('저장했습니다.');
      }
      closeSubview('view-editor');
      await reload();
      // 방금 저장한 카드로 자동 스크롤 + 하이라이트 (새 항목이 목록 어디 있는지 찾아다니는 불편 제거)
      if (state.editingId) {
        flashCard(state.editingId);
      } else {
        const newest = visibleCodes().find((c) => c.value === value);
        if (newest) flashCard(newest.id);
      }
    } catch (e) {
      console.warn(e);
      toast('저장에 실패했습니다. 저장 공간을 확인해 주세요.');
    }
  }

  // 스캔 결과를 에디터로 채우기
  async function applyScanResult(result) {
    state.scannedValue = result.text;
    state.scannedFormat = result.format || '';
    const looksLikeQr = !isOneD(result.format);
    setTypeSeg(looksLikeQr ? 'qr' : 'barcode');

    $('#inp-value').value = result.text;
    document.getElementById('scan-badge').classList.remove('hidden');
    if (!state.editingId && !$('#inp-name').value.trim()) {
      // 이름은 사용자가 직접 입력하도록 비워 둔다 (포커스는 openSubview 후 에디터에서)
    }
    await refreshPreview();
    toast('코드를 인식했습니다!');
  }

  function isOneD(formatName) {
    return ['EAN_13','EAN_8','UPC_A','UPC_E','CODE_128','CODE_39','CODE_93','ITF','CODABAR','RSS_14','RSS_EXPANDED']
      .includes(formatName);
  }

  // ---------- 카메라 화면 ----------
  async function openCameraFlow() {
    resetEditor();
    openSubview('view-editor');
  }

  function showCameraError(msg) {
    document.getElementById('camera-error').classList.remove('hidden');
    document.getElementById('camera-error-text').textContent = msg;
    document.getElementById('scan-msg').classList.add('hidden');
  }

  async function openCamera(onScanned) {
    document.getElementById('camera-error').classList.add('hidden');
    document.getElementById('scan-msg').classList.remove('hidden');
    openSubview('view-camera');

    const handle = async (result) => {
      CP.Scanner.Camera.stop();
      closeSubview('view-camera');
      if (onScanned) await onScanned(result);
    };

    try {
      await CP.Scanner.Camera.start(handle, (err) => {
        console.warn('카메라 오류:', err);
        const name = err && err.name;
        if (name === 'NotAllowedError') {
          showCameraError('카메라 권한이 거부되었습니다.\n브라우저 설정에서 권한을 허용하거나, 갤러리에서 사진을 선택해 주세요.');
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          showCameraError('사용 가능한 카메라를 찾을 수 없습니다.\n갤러리에서 사진을 선택해 주세요.');
        } else {
          showCameraError('카메라를 시작할 수 없습니다.\n갤러리에서 사진을 선택해 스캔할 수 있어요.');
        }
      });
    } catch (e) {
      showCameraError('카메라를 사용할 수 없습니다. 갤러리에서 사진을 선택해 주세요.');
    }
  }

  // 갤러리 파일 스캔 (에디터의 미리보기로 연결)
  async function pickAndScanFile(inputEl) {
    const file = inputEl.files && inputEl.files[0];
    inputEl.value = '';
    if (!file) return;
    toast('이미지를 분석하는 중...');
    try {
      const result = await CP.Scanner.scanFile(file);
      if (result) {
        // 사진 원본 저장 옵션
        const keep = await askKeepPhoto(file);
        if (keep) {
          try {
            const resized = await resizeImageFile(file, 900);
            editorPhotoDataUrl = resized;
          } catch (_) { editorPhotoDataUrl = null; }
        } else {
          editorPhotoDataUrl = null;
        }
        await applyScanResult(result);
      } else {
        // 자동 인식 실패 -> 직접 입력 안내
        CP.showModal({
          title: '자동 인식 실패',
          msg: '사진에서 코드를 찾지 못했습니다.\n아래 "코드 내용"에 숫자나 링크를 직접 입력할 수 있어요.',
          buttons: [{ label: '직접 입력하기', class: 'btn-primary' }]
        });
      }
    } catch (e) {
      console.warn(e);
      toast('이미지를 읽지 못했습니다.');
    }
  }

  let editorPhotoDataUrl = null;

  function askKeepPhoto(file) {
    return new Promise((resolve) => {
      CP.showModal({
        title: '원본 사진도 저장할까요?',
        msg: '카드 사진을 함께 저장하면 나중에 라벨 등을 다시 볼 수 있어요.',
        buttons: [
          { label: '저장', class: 'btn-primary', onClick: () => resolve(true) },
          { label: '코드만 저장', class: 'btn-secondary', onClick: () => resolve(false) }
        ]
      });
    });
  }

  function resizeImageFile(file, maxDim) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        try {
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * scale);
          c.height = Math.round(img.height * scale);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
          resolve(c.toDataURL('image/jpeg', 0.8));
        } catch (e) { reject(e); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지 로드 실패')); };
      img.src = url;
    });
  }

  // ---------- 뷰어 ----------
  async function openViewer(id) {
    const code = await safeGetCode(id);
    if (!code) { toast('항목을 찾을 수 없습니다.'); await reload(); return; }
    state.currentViewId = id;

    const canvas = $('#viewer-canvas');
    const ok = await CP.Generator.drawCode(canvas, code);
    if (!ok) {
      toast('이 코드를 다시 그릴 수 없습니다.');
    }

    $('#viewer-name-text').textContent = code.name;
    document.getElementById('viewer-star').classList.toggle('hidden', !code.favorite);
    const typeLabel = code.type === 'barcode' ? (CP.fmtLabel(code.format) || '바코드') : 'QR 코드';
    $('#viewer-meta').textContent = `${typeLabel} · ${CP.fmtDate(code.createdAt)}`;
    $('#viewer-value').textContent = code.value;

    const photo = document.getElementById('viewer-photo');
    if (code.photoDataUrl) {
      photo.src = code.photoDataUrl;
      photo.classList.remove('hidden');
    } else {
      photo.classList.add('hidden');
      photo.removeAttribute('src');
    }

    syncBrightBtn();
    openSubview('view-viewer');
  }

  function syncBrightBtn() {
    const btn = document.getElementById('btn-brightness');
    if (!btn) return;
    btn.classList.toggle('active', state.viewerBright);
    btn.textContent = state.viewerBright ? '☀️ 밝기 끄기' : '☀️ 밝기 최대';
  }

  // ---------- 내보내기/가져오기 ----------
  async function exportData() {
    try {
      const json = await CP.DB.exportJson();
      const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
      const ts = new Date().toISOString().slice(0, 10);
      CP.downloadBlob(blob, `codepocket-backup-${ts}.json`);
      toast('백업 파일을 내보냈습니다.');
    } catch (_) {
      toast('내보내기에 실패했습니다.');
    }
  }

  function importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const obj = JSON.parse(text);
        const n = await CP.DB.importJson(obj);
        await reload();
        toast(`${n}개 항목을 가져왔습니다.`);
      } catch (e) {
        console.warn(e);
        toast('가져오기 실패: 올바른 백업 파일인지 확인해 주세요.');
      }
    };
    input.click();
  }

  // ---------- 전체 초기화(데이터 관리용) ----------
  function requestClearAll() {
    CP.confirmModal('전체 삭제', '저장된 모든 코드를 삭제할까요?\n이 작업은 되돌릴 수 없습니다.', async () => {
      try {
        await CP.DB.clearAll();
        await reload();
        toast('모든 코드를 삭제했습니다.');
      } catch (_) { toast('삭제에 실패했습니다.'); }
    });
  }

  // ---------- 바인딩 ----------
  function bind() {
    on(document.querySelectorAll('[data-close]'), 'click', function (e) {
      closeSubview(this.dataset.close);
    });

    // 상단 히어로 CTA (유일한 '코드 추가' 버튼)
    on($('#btn-add-hero'), 'click', () => openEditor(null));
    on($('#btn-save'), 'click', saveFromEditor);

    // 목록 맨 위로 버튼
    setupScrollTop();
    on($('#btn-scroll-top'), 'click', goToTop);

    on($('#btn-shot'), 'click', async () => {
      await openCamera(async (result) => {
        await applyScanResult(result);
        editorPhotoDataUrl = null; // 카메라 스캔은 원본 사진 없음
        openSubview('view-editor');
      });
    });
    on($('#btn-gallery'), 'click', () => $('#file-input').click());
    on($('#file-input'), 'change', function () { pickAndScanFile(this); });
    on($('#btn-pick-image'), 'click', () => $('#camera-file-input').click());
    on($('#camera-file-input'), 'change', async function () {
      const file = this.files && this.files[0];
      this.value = '';
      if (!file) return;
      toast('이미지를 분석하는 중...');
      try {
        const result = await CP.Scanner.scanFile(file);
        CP.Scanner.Camera.stop();
        closeSubview('view-camera');
        if (result) {
          await applyScanResult(result);
          openSubview('view-editor');
        } else {
          openSubview('view-editor');
          CP.showModal({
            title: '자동 인식 실패',
            msg: '사진에서 코드를 찾지 못했습니다.\n"코드 내용"에 직접 입력할 수 있어요.',
            buttons: [{ label: '직접 입력하기', class: 'btn-primary' }]
          });
        }
      } catch (_) {
        toast('이미지를 읽지 못했습니다.');
      }
    });

    on($('#btn-camera-retry'), 'click', () => {
      document.getElementById('camera-error').classList.add('hidden');
      CP.Scanner.Camera.start(state._camResult || (() => {}), state._camError);
    });

    on($('#search-input'), 'input', function () {
      state.search = this.value;
      renderList();
    });

    on(document.querySelectorAll('#type-seg button'), 'click', function () {
      setTypeSeg(this.dataset.type);
      refreshPreview();
    });

    on($('#inp-value'), 'change', refreshPreview);
    on($('#inp-value'), 'blur', refreshPreview);

    // 뷰어 액션
    on($('#btn-brightness'), 'click', async () => {
      state.viewerBright = await CP.Brightness.toggle();
      syncBrightBtn();
    });
    on($('#btn-edit'), 'click', async () => {
      const code = state.codes.find((c) => c.id === state.currentViewId);
      closeSubview('view-viewer');
      if (code) openEditor(code);
    });
    on($('#btn-fullscreen'), 'click', async () => {
      try {
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen();
        } else {
          await document.exitFullscreen();
        }
      } catch (_) {
        toast('이 기기를 지원하지 않습니다. (iPhone은 전체 화면 버튼을 이용해 주세요)');
      }
    });

    // 뷰어 바디 롱프레스 -> 삭제 확인 (모바일 편의)
    let pressTimer = 0;
    const body = document.querySelector('#view-viewer .viewer-body');
    on(body, 'pointerdown', () => {
      pressTimer = setTimeout(() => {
        const code = state.codes.find((c) => c.id === state.currentViewId);
        if (code) confirmDeleteCode(code);
      }, 650);
    });
    ['pointerup', 'pointerleave', 'pointercancel', 'scroll'].forEach((ev) =>
      on(body, ev, () => clearTimeout(pressTimer))
    );

    // ⋮ 메뉴 닫기
    const menuBackdrop = document.getElementById('menu-backdrop');
    on(menuBackdrop, 'click', closeCardMenu);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeCardMenu();
    });

    // 이름 수정 모달
    on($('#rename-cancel'), 'click', closeRenameModal);
    on($('#rename-submit'), 'click', submitRename);
    on($('#rename-modal'), 'click', function (e) { if (e.target === this) closeRenameModal(); });
    on($('#rename-input'), 'keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submitRename(); }
    });
  }

  CP.UI = {
    init() {
      renderList();
      bind();
    },
    reload,
    openEditor,
    openViewer,
    exportData,
    importData,
    requestClearAll,
    openSubview,
    closeSubview,
    state
  };
})();
