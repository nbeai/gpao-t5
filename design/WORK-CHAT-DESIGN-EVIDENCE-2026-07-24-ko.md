# Work Chat 디자인 Evidence (slice-1)

- Date: 2026-07-24 (감사 후 보정)
- Author: Claude Code (구현자)
- 대상: `src/surface/web/index.html` + `src/surface/server.js` (slice-1 Work Chat)
- 근거 정본: `GPAO-T5-UIUX-REFERENCE-SEAL-2026-07-24-ko.md`
- 목적: 감사가 요구한 사용자 표면 시각 증거(PNG). 아래 PNG는 모두 라이브 서버에서 실제 캡처했다.

## 0. 정정 (앞선 문서의 오류)

이 문서의 이전 판은 "샌드박스에서 스크린샷을 저장소에 커밋할 수 없다"고 적었다. **그 서술은 틀렸다.**
Codex 감사가 실제 PNG를 캡처해 커밋했고(초기 desktop/mobile 2장), 이번 보정에서 구현자도
Chrome headless + DevTools Protocol로 실제 PNG를 캡처해 커밋했다. 시각 증거는 PNG로 저장한다.

## 1. 캡처 도구 (재현 가능)

`design/evidence/capture.mjs` — Chrome headless + CDP, 저장소 의존성 0(node 내장 fetch/WebSocket).
로컬 Google Chrome 필요. 재현:

```bash
npm start                                             # 앱 서버(기본 4173)
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars \
  --remote-debugging-port=9222 --user-data-dir="$(mktemp -d)" about:blank &
OUT_DIR=design/evidence/2026-07-24-slice1 APP_URL=http://localhost:4173 \
  node design/evidence/capture.mjs
```

## 2. 커밋된 PNG (`design/evidence/2026-07-24-slice1/`)

| 파일 | 상태 | 확인 포인트 |
| --- | --- | --- |
| `workchat-initial-desktop-1280.png` | 데스크톱 첫 화면 | 조용한 사이드바 + 넓은 채팅 + 하단 입력 + 상태칩 |
| `workchat-initial-mobile-375.png` | 모바일 375 첫 화면 | **하단 입력 잘림 수정: 보내기 버튼 완전 노출** |
| `workchat-initial-mobile-390.png` | 모바일 390 첫 화면 | 반응형 유지 |
| `workchat-initial-mobile-430.png` | 모바일 430 첫 화면 | 반응형 유지 |
| `workchat-approval-card.png` | 인라인 승인 카드 | 흐름 안 카드, 라벨 `슬랙 게시`, [승인]/[보내지 마] |
| `workchat-approved-record.png` | 승인 후 실행 | 답 + 펼친 `작업 기록 · 도구 1개`(확인 근거) |
| `workchat-mobile-375-approval.png` | 모바일 375 승인 카드 | 좁은 폭에서도 카드·입력·보내기 정상 |

## 3. 모바일 입력 잘림 수정 (감사 지적)

- 증상(375px): 하단 입력 오른쪽이 잘려 `보내기`가 안 보임.
- 원인: `#text`(flex textarea)에 `min-width:0`이 없어 placeholder 폭만큼 최소너비가 잡혀 버튼을
  화면 밖으로 밀어냄.
- 수정: `#text{min-width:0}` + `#send{flex:none;white-space:nowrap}` + 좁은 폭 여백 축소 +
  아주 좁을 때 힌트 문구 숨김.
- 검증: `workchat-initial-mobile-375.png` / `workchat-mobile-375-approval.png` 에서 보내기 노출 확인.

## 4. Reference Seal 대비 체크

| Seal 기준 | 충족 | 증거 |
| --- | --- | --- |
| 3영역 골격 | ✔ | desktop-1280 |
| 고기능 접어서 대화 안에 | ✔ | approved-record |
| 작은 보조 상태(칩·하단행) | ✔ | 전체 |
| 인라인 승인(모달 아님) | ✔ | approval-card |
| 내부 id/스키마 비노출 | ✔ | approval-card(`슬랙 게시` 라벨) |
| 반응형(375/390/430) | ✔ | mobile-375/390/430 |
| 죽은 버튼 금지 | ✔ | 미구축은 "곧" 안내 |
| 실제 세션 다건·검색 | ✖ 이월(P1) | — |
| 실제 BEAI5/LLM | ✖ 스텁 | — |

## 5. 남은 표면 작업 (이월)

실제 세션 다건·검색, 스킬/연결/자동화 실화면(P1), 캔버스 병치(P1), 시각 토큰 정교화,
BEAI5 모델 경계 연결. 이 PNG 세트가 그 작업의 시각 회귀 기준선이다.
