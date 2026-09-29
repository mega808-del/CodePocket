/* CodePocket 데이터 계층: IndexedDB 저장 (서버 전송 없음, 로컬 전용)
 * 스키마:
 *   codes (keyPath id)   : { id, name, memo, category, type:'qr'|'barcode', value, format,
 *                            photoDataUrl|null, favorite, createdAt, updatedAt }
 *   meta  (keyPath key)  : { key, value }  (예: version)
 * 전역: window.CodePocket.DB
 */
'use strict';

(function () {
  const CP = (window.CodePocket = window.CodePocket || {});
  const DB_NAME = 'codepocket';
  const DB_VERSION = 1;
  const STORE_CODES = 'codes';
  const STORE_META = 'meta';

  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('이 브라우저는 IndexedDB를 지원하지 않습니다.'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (ev) => {
        const db = ev.target.result;
        if (!db.objectStoreNames.contains(STORE_CODES)) {
          const store = db.createObjectStore(STORE_CODES, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt');
          store.createIndex('favorite', 'favorite');
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('DB 열기 실패'));
      req.onblocked = () => reject(new Error('DB가 다른 탭에 의해 잠겨 있습니다.'));
    });
    // 실패 시 재시도 가능하도록 실패하면 캐시 클리어
    dbPromise.catch(() => { dbPromise = null; });
    return dbPromise;
  }

  function tx(storeName, mode, fn) {
    return openDB().then(
      (db) =>
        new Promise((resolve, reject) => {
          const t = db.transaction(storeName, mode);
          const store = t.objectStore(storeName);
          let result;
          try {
            result = fn(store);
          } catch (e) {
            reject(e);
            return;
          }
          t.oncomplete = () => resolve(result && result.__value !== undefined ? result.__value : result);
          t.onerror = () => reject(t.error);
          t.onabort = () => reject(t.error || new Error('트랜잭션 중단'));
        })
    );
  }

  // request를 promise로: 트랜잭션 완료까지 대기
  function reqP(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function newId() {
    return 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  const DB = {
    async addCode(data) {
      const now = Date.now();
      const rec = {
        id: newId(),
        name: data.name || '이름 없는 코드',
        memo: data.memo || '',
        category: data.category || 'other',
        type: data.type === 'barcode' ? 'barcode' : 'qr',
        value: data.value || '',
        format: data.format || '',
        photoDataUrl: data.photoDataUrl || null,
        favorite: !!data.favorite,
        createdAt: now,
        updatedAt: now
      };
      await tx(STORE_CODES, 'readwrite', (store) => { store.add(rec); });
      return rec;
    },

    async updateCode(id, patch) {
      return tx(STORE_CODES, 'readwrite', (store) => {
        const p = reqP(store.get(id)).then((rec) => {
          if (!rec) throw new Error('항목을 찾을 수 없습니다.');
          const next = Object.assign({}, rec, patch, { id, updatedAt: Date.now() });
          store.put(next);
          return next;
        });
        p.__value = undefined;
        // 트랜잭션 완료 시 최신 rec을 돌려주도록 래핑
        return p;
      }).then((rec) => rec);
    },

    async deleteCode(id) {
      await tx(STORE_CODES, 'readwrite', (store) => { store.delete(id); });
      return true;
    },

    async getCode(id) {
      return tx(STORE_CODES, 'readonly', (store) => reqP(store.get(id)));
    },

    async listCodes() {
      return tx(STORE_CODES, 'readonly', (store) => reqP(store.getAll()));
    },

    async setFavorite(id, fav) {
      return this.updateCode(id, { favorite: !!fav });
    },

    // ---------- 내보내기 / 가져오기 ----------
    async exportJson() {
      const codes = await this.listCodes();
      return {
        app: 'CodePocket',
        schema: 1,
        exportedAt: new Date().toISOString(),
        codes
      };
    },

    async importJson(obj, { replace = false } = {}) {
      if (!obj || obj.app !== 'CodePocket' || !Array.isArray(obj.codes)) {
        throw new Error('올바른 CodePocket 백업 파일이 아닙니다.');
      }
      const incoming = obj.codes
        .filter((c) => c && typeof c.value === 'string' && c.value.length)
        .map((c) => ({
          id: typeof c.id === 'string' && c.id ? c.id : newId(),
          name: String(c.name || '이름 없는 코드').slice(0, 60),
          memo: String(c.memo || '').slice(0, 100),
          category: ['hospital', 'office', 'parking', 'gym', 'other'].includes(c.category) ? c.category : 'other',
          type: c.type === 'barcode' ? 'barcode' : 'qr',
          value: String(c.value).slice(0, 5000),
          format: String(c.format || '').slice(0, 30),
          photoDataUrl: typeof c.photoDataUrl === 'string' && c.photoDataUrl.length < 3_000_000 ? c.photoDataUrl : null,
          favorite: !!c.favorite,
          createdAt: Number(c.createdAt) || Date.now(),
          updatedAt: Number(c.updatedAt) || Date.now()
        }));

      await tx(STORE_CODES, 'readwrite', (store) => {
        if (replace) store.clear();
        for (const rec of incoming) store.put(rec); // 같은 id면 덮어씀 (병합)
      });
      return incoming.length;
    },

    async clearAll() {
      await tx(STORE_CODES, 'readwrite', (store) => { store.clear(); });
      return true;
    },

    // 스토리지 사용량 (지원 브라우저)
    async storageEstimate() {
      try {
        if (navigator.storage && navigator.storage.estimate) {
          const est = await navigator.storage.estimate();
          return { usage: est.usage || 0, quota: est.quota || 0 };
        }
      } catch (_) { /* 미지원 */ }
      return null;
    }
  };

  CP.DB = DB;
})();
