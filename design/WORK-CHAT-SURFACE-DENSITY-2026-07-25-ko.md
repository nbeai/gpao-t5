# Work Chat Surface Density (Phase 5 Surface Slice 1)

- Date: 2026-07-25
- Author: Claude Code (구현자)
- 대상: `src/surface/web/index.html`
- 근거 정본: `GPAO-T5-UIUX-REFERENCE-SEAL` §1.1(CSS craft 참고원) · UX Architecture §1.2(안티 대시보드)
- 완료 기준(오너 지시): 테스트 통과가 아니라 **데스크톱/모바일 브라우저 렌더에서 자연 웹챗 + 조용한
  고기능 표면**이 확인되는 것.

## 1. 무엇을 했나

토큰 체계를 세우고 **현재 Work Chat 화면에 바로 적용**했다(토큰은 수단, 목표는 채팅 표면 밀도).

- **토큰 체계**(T5 자기 소유, 인라인 `:root`):
  - 간격 `--sp-1..7`(4px 리듬), radius `--r-sm/md/lg/full`, 타이포 `--fs-xs..base`,
    shadow `--sh-sm/md/lg`(웜 틴트), 모션 `--dur-fast/normal/slow` + `--ease-out/spring`,
    색 층상(bg/surface/panel/elevated/hover/line/fg/muted/faint/accent/warn/ok/danger).
  - 라이트(웜 페이퍼)·다크(웜 다크) 양쪽, 사용자 토글이 media query를 양방향으로 이김.
- **밀도 정리**: 메시지 버블(웜 그림자 + 비대칭 radius), 입력창(elevated + focus 링 `--accent-glow`),
  승인 카드(elevated + `--sh-md` + rise 애니메이션), 작업 기록 토글(chevron 회전 `--dur-fast`),
  사이드바(active 세션 카드화, dot glow), 버튼(press `--ease-spring`).
- **접근성**: `prefers-reduced-motion` 시 전 전환·애니메이션 억제(OpenClaw motion 규율 흡수).

## 2. craft 출처 (OpenClaw `ui/` — 감각만 흡수, 복제 아님)

| 흡수한 감각 | 출처 | T5 재구성 |
| --- | --- | --- |
| 4px 간격 리듬(4/8/12/16/20/24/32) | `ui/src/styles/base.css` `--space-*` | `--sp-1..7`(T5명) |
| radius 스케일(sm/md/lg/full) | base.css `--radius-*` | `--r-*`(값 T5 튜닝) |
| 3단 모션 + ease-out 기본 + reduced-motion | `ui/docs/design-system/motion.md` | `--dur-*`/`--ease-out`(기능 곡선) |
| 웜 틴트 그림자(light에서 갈색 rgba) | base.css `--shadow-*` light | `--sh-*`(T5 웜값) |
| 층상 배경 + WCAG 대비 규율 | `design-system/color-tokens.md` | bg/surface/panel/elevated 층 |

**복제하지 않은 것(§1.1·§4 경계)**: `--oc-*`/`<openclaw-*>` 토큰·클래스명, 그들의 accent
정체성(terracotta `#bd4531`/coral `#ff5c5c` → T5는 자기 웜브라운 `#7c6f5b`/다크 `#c9b48c` 유지),
40-라우트 콘솔 IA. 감각(리듬·모션·대비)만 배우고 T5 자기 언어로 다시 썼다.

## 3. 렌더 확인 (완료 기준) — `design/evidence/2026-07-25-surface-density/`

| 파일 | 확인 |
| --- | --- |
| `workchat-initial-desktop-1280.png` | 자연 웹챗 + 조용한 고기능, T3보다 단단한 밀도 |
| `workchat-initial-mobile-375/390/430.png` | 반응형 유지, 보내기 버튼 노출(잘림 없음) |
| `workchat-approval-card.png` / `workchat-mobile-375-approval.png` | 인라인 승인 카드 elevated, 라벨만(id 없음) |
| `workchat-approved-record.png` | 답 + 접힌 "작업 기록" 밀도 정리 |

캡처: `design/evidence/capture.mjs`(Chrome headless + CDP, 재현 가능).

## 4. 회귀 검사 (슬라이스 범위)

- **내부 도구 id 노출**: 없음 — 상태·승인·원장 모두 라벨(`슬랙 게시` 등). id-노출 테스트 유지 통과.
- **대시보드 퇴행**: 없음 — 기본 화면은 채팅, 상태·설정·원장은 접힘/보조.
- **텍스트 잘림**: 없음 — `#text{min-width:0}`·`#send{flex:none}` 유지, 모바일 게이트 통과.
- 전체 56개 테스트 통과(회귀 게이트 포함).

## 5. 이 슬라이스에서 하지 않은 것 (오너 범위)

세션 다건, 자동화 화면, 연결 관리 고도화, P6 기억/POM/T-cell, 새 대형 UI 구조 — 전부 비범위.
이 슬라이스는 채팅 표면의 그릇·밀도만 단단히 한다.
