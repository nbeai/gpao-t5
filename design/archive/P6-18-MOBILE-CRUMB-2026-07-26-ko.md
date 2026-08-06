# P6-18 · 모바일 375px 회귀 — 크럼 압축

작성: 2026-07-26 · 상태: 구현·라이브 검증 완료, 깊은 감사 대기.
근거: P6-18 표면 통합 후 모바일 회귀 정리(로드맵 잔여 1순위). 관련: [[gpao-t5-hermes-absorption-roadmap]].

## 왜 (안 깨진 건 안 고친다 — 실측 먼저)

375px 실측 결과 **overview 패널·검색 패널·본문은 이미 잘 나온다**(섹션 1열 스택, 액션 버튼 인라인, 오버플로
없음). 유일한 회귀는 **크럼 행**: 브레드크럼("GPAO-T5 › Work Chat") + "🔍 기억 찾기" + "준비됨"이 375px에
안 들어가 각 항목이 단어 중간에서 2줄로 꺾였다("기억 찾"/"기", "준비"/"됨"). 다른 팀의 composer 회귀
가드(#text min-width:0, #send flex:none)는 이미 있었다 — 이건 크럼만의 문제.

## 수정 (외과적 — 크럼만)

- **단어 중간 줄바꿈 방지**: `#searchbtn, #chip { white-space:nowrap; flex:none; }`. 브레드크럼은 `.bc`로 감싸
  `white-space:nowrap; overflow:hidden; text-overflow:ellipsis`(좁으면 말줄임, 줄바꿈 아님).
- **모바일 압축(≤720px)**: 앱 이름·구분자(`.appn`) 숨겨 "Work Chat"만, 검색 버튼은 라벨(`.sb-t`) 숨겨 🔍
  아이콘만. 크럼·상태·검색 패널 좌우 패딩 축소. → ☰ · Work Chat · 🔍 · 준비됨 한 줄에 들어간다.
- HTML 훅 추가: 브레드크럼 `<span class="bc"><span class="appn">…</span>Work Chat</span>`, 검색 라벨
  `<button id="searchbtn">🔍<span class="sb-t"> 기억 찾기</span></button>`.
- **데스크톱 불변**: 전체 라벨("GPAO-T5 › Work Chat", "🔍 기억 찾기") 그대로.

## 테스트 (3, 총 292; test/mobile-layout.test.js에 추가)

node엔 레이아웃 엔진이 없어 **구조적 불변식**을 고정한다(기존 팀의 composer 가드 방식과 동일):
크럼 버튼 nowrap + 브레드크럼 말줄임 · 모바일 media query가 앱이름·검색라벨 숨김 · HTML에 .bc/.appn/.sb-t 훅.
(레이아웃 자체는 라이브 브라우저 375px로 검증. 기존 팀의 design/evidence/capture.mjs는 건드리지 않음.)

반대 테스트: 수정 전 index.html(HEAD)로 되돌리면 크럼 가드 3건 실패, 기존 composer 가드는 통과 실측.
라이브(375px): 크럼 한 줄(☰·Work Chat·🔍·준비됨), overview·검색 패널 정상. 데스크톱: 전체 라벨 유지.

## 완료/미완료 (사용자 언어)

- **된 것**: 좁은 폰 화면에서 상단 바가 단어 중간에서 꺾이지 않고 한 줄로 깔끔히 들어간다. 넓은 화면은 그대로.
- **아직 아닌 것**: 아주 좁은(≤360px) 극단 폭 미세조정, 헤드리스 시각 스냅샷 자동화(기존 capture.mjs 확장).

## 남은 후속

- 로드맵 잔여: P6-16 채널 정책 실제 소비 · 의미 검색 · 반영 중 기억 출처 표시.
