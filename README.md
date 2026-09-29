# CodePocket 📱

병원·사무실·주차장·헬스장 등의 **QR코드/바코드를 휴대폰에 저장**하고, 필요할 때 **화면에 크게 보여주는** 모바일 PWA 앱입니다.

- **서버 전송 없음**: 모든 데이터는 휴대폰의 IndexedDB에만 저장됩니다 (회원가입/로그인/광고/결제 없음)
- **오프라인 완전 동작**: 설치 후 인터넷 없이 실행·스캔·표시 모두 가능
- **Android / iPhone 모두 지원** (반응형 PWA)

## 주요 기능

| 기능 | 설명 |
|---|---|
| 코드 추가 | 카메라 촬영 또는 갤러리 사진 선택 → 자동 인식 |
| 직접 입력 | 자동 인식 실패 시 QR 링크/바코드 숫자를 직접 입력 |
| 이름/카테고리 | "병원", "사무실", "주차장", "헬스장", "기타"로 분류 |
| 목록/검색 | 카드형 목록 + 이름·메모·내용 검색 + 카테고리 필터 |
| 즐겨찾기 | 별 아이콘으로 즐겨찾기 고정 (목록 상단 정렬) |
| 큰 화면 표시 | 저장된 데이터로 QR/바코드를 선명하게 재생성해 표시 |
| 전체 화면 | 뷰어의 ⛶ 버튼 (미지원 기기는 밝기 최대 모드로 대체) |
| 밝기 최대 | 화면 꺼짐 방지(Wake Lock) + 흰 배경 최대 밝기 표시 |
| 원본 사진 | 카드 사진을 선택적으로 함께 저장 |
| 백업 | JSON 내보내기/가져오기 (기기 이동·백업용) |

## GitHub Pages 배포

정적 웹앱이므로 별도 서버가 필요 없습니다.

1. 이 저장소를 GitHub에 업로드합니다.
2. 저장소 **Settings → Pages → Source: Deploy from a branch**에서 `main` 브랜치 `/ (root)`를 선택합니다.
3. 몇 분 후 `https://<사용자명>.github.io/<저장소명>/`에서 사용할 수 있습니다.

모든 경로(manifest, 아이콘, Service Worker)가 **상대 경로**로 작성되어 있어
프로젝트 페이지의 하위 주소(`~/<저장소명>/`)에서도 그대로 동작합니다.

## 설치 방법

- **Android (Chrome)**: 첫 화면의 **📲 앱으로 설치하기** 버튼 → 설치 프롬프트 확인
- **iPhone (Safari)**: **📲 설치 방법 보기** → 공유 버튼 → **홈 화면에 추가** → 추가
- 설치하지 않고 브라우저에서 바로 사용도 가능합니다 (설치 안내는 "바로 사용하기"로 숨길 수 있음)

## 기술 구성

- 순수 HTML/CSS/JavaScript — 프레임워크·빌드 과정 없음
- QR 생성: [node-qrcode](https://github.com/soldair/node-qrcode) (vendor 번들, 오프라인)
- QR/바코드 인식: [@zxing/library](https://github.com/zxing-js/library) 0.21.3 (vendor 번들, 오프라인)
- 1D 바코드 재생성: EAN-13/EAN-8/CODE128 자체 구현 (ZXing 디코딩 검증 테스트 포함)
- 저장: IndexedDB (`codepocket` DB, 기기 로컬 전용)
- PWA: `manifest.webmanifest` + `sw.js` (앱 셸 선캐시, 오프라인 폴백)

## 개발/검증

```bash
# QR 생성↔디코딩 라운드트립 (6건)
node test/roundtrip.test.js

# 바코드 인코더 정합성 - ZXing 디코딩 검증 (12건)
node test/barcodes.test.js

# 브라우저 스모크 테스트 (22건, Chrome 필요)
node test/smoke.browser.js

# 아이콘 재생성
node scripts/make-icons.js
```

## 개인정보

이 앱은 데이터를 **기기 외부로 전송하지 않습니다**. 카메라 화면·스캔 이미지·코드 데이터는
모두 브라우저 안에서만 처리되며, GitHub이나 외부 서버에 저장되지 않습니다.
