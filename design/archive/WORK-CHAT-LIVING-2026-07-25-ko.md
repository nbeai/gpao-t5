# Living Work Chat (Phase 5 Surface Slice 2)

- Date: 2026-07-25
- Author: Claude Code (구현자)
- 대상: `src/surface/session-store.js`(신규) · `src/surface/server.js` · `src/surface/web/index.html`
- 완료 기준(오너): 세션 다건·전환·**파일 지속**이 브라우저에서 실제로 살아있게 동작.

## 1. 무엇을 했나

껍질(밀도)을 넘어 **살아있는 Work Chat** — 실제 세션·전환·지속.

- **실제 세션 다건**: `SessionStore`(파일 기반)가 세션을 실제로 보관. 세션별 transcript·원장 분리.
  `새 대화`가 진짜 새 세션 생성, 사이드바 목록이 실제 목록(가짜 없음), 첫 발화로 제목 자동.
- **대화 전환**: 세션 클릭 시 그 세션 transcript를 불러와 렌더. 세션 간 맥락 오염 없음(격리).
- **파일 지속**: 각 턴 후 세션을 JSON 파일로 저장(소스 트리 밖, `GPAO_T5_DATA_DIR` override).
  새로고침·재접속 후에도 대화가 남는다.
- **색 위계 분리**(주의점 반영): 권한 등급 배지(A2=info톤 / A3=danger톤), 준비 상태 칩 dot(ok색),
  `--info`/`--*-subtle` semantic 토큰 추가. 웜 모노에 상태·강조가 묻히지 않게.

## 2. 세션 계약 (P6 정합 — 다시 안 뜯게)

세션 = **자기 완결 대화 컨텍스트**: `{id, title, createdAt, updatedAt, transcript, ledgerEntries}`.
- env/model/tools는 세션에 담지 않고 **프로세스 공유** — P6 Project/Profile 격리가 그 위를 감싸는 seam.
- 세션별 원장(ledgerEntries) + pending(라이브, 비지속) 분리 — Hermes profile-home 격리의 축소판.
- 세션 id는 UUID, 경로 탈출 검증(`SAFE_ID`)으로 파일 접근 보안.

## 3. 검증 (완료 기준)

**HTTP(curl)**: 빈 목록→생성→발화 지속(제목 자동·transcript 2)→**디스크 2개 파일**→격리(S1에 S2 발화 0).
**브라우저 렌더**(`design/evidence/2026-07-25-living/`):
- desktop: 사이드바 실제 세션 2개(active 카드), 답 지속·복원, 칩 green dot.
- approval: A2 배지가 구분된 info-톤 pill(색 위계 분리 확인), 라벨만(id 없음).
- mobile 375/390/430: 반응형·보내기 노출.

**테스트**: 65개 통과(+session-store 5, server 세션 라우트·격리·지속·승인재개).

## 4. 회귀 검사

- 내부 id 노출 없음 · 대시보드 퇴행 없음(채팅이 전부) · 텍스트 잘림 없음(모바일 게이트 통과).
- 세션 격리 테스트(단위+HTTP)로 맥락 오염 방지 고정.

## 5. 범위 밖 (오너)

자동화 화면, 연결 관리 고도화, P6 기억/POM/T-cell, 멀티채널 — 손대지 않음.
세션 삭제 UI도 이번 비범위(삭제는 되돌리기 어려운 행동 — 별도 승인 흐름 필요).

## 6. 조건부 통과 메모 (Codex 감사) — 병합은 진행, 후속 필수

이 슬라이스는 조건부 통과로 main 병합했다. 아래는 병합을 막지 않되 반드시 이어갈 경계다.

1. **승인 대기의 지속성(P6 전 필수)**: 승인 대기(pending)는 서버 메모리 `livePending`에만 있다.
   재시작/새로고침 후 "지난 승인 요청"은 transcript로 보이지만 **그 승인을 이어 실행할 수 없을 수 있다**.
   → **P6 권한/원장 진입 전에 "승인 지속/만료/재승인 경계"를 별도 계약으로** 정리한다(Tool & Connector
   Seal §닫는말에도 동일 기재). AuthorityGrant에 승인 수명(기간·만료·재승인 요구)을 계약화.
2. **모바일 승인 카드 줄바꿈**: "되돌릴 수 있음" 류 문구가 좁은 폭에서 어색하게 줄바꿈될 여지. 다음 UI
   보정에서 `word-break: keep-all` 계열로 다듬는다(비차단).
3. **상태칩 경고색 로직**: "준비됨"인데 일부 제한 때문에 경고색처럼 보이는 기존 판정 로직. 다음 표면
   보정 후보 — 준비/주의/막힘을 색으로 더 정확히 분리(비차단).
