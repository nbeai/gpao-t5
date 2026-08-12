# Peekaboo 소스 고정본 (pin) — CU0

- 날짜: 2026-08-04
- 목적: 계획서 §9 CU0 *"업데이트는 수동 감사 후 pin 변경만 허용, **런타임 다운로드 금지**"*
- 성격: **소스만 받았다. 빌드·실행하지 않았다.** 릴리스 `.app`/`.dmg` 바이너리는 받지 않았다.
- 자리: `/Users/jyp/Developer/t5-cu0-staging/` — **T5 저장소 밖**이다. 벤더링 아님.

---

## 고정 좌표

| 대상 | 값 |
|---|---|
| 저장소 | `https://github.com/steipete/Peekaboo.git` |
| 태그 | `v3.9.10` (2026-08-03 04:07 UTC) |
| 커밋 | `eae9bfa69b15109b75e5bec1288bf901b51f0fa9` |
| 서브모듈 `AXorcist` | `dbafbe3a73a46f2d889fdbec53d550f8df919061` (`openclaw/AXorcist`, exact `0.1.6`) |

**릴리스 API 가 준 커밋과 클론 HEAD 가 일치한다** — provenance 확인됨.

## 라이브러리 4타깃 트리 지문

제품에 링크할 것은 이 넷뿐이다. 각 경로의 git tree hash 를 고정한다 —
**upstream 이 바뀌면 이 값이 바뀐다.** 재확인은 아래 명령 한 줄이다.

```
PeekabooFoundation     b13aee2a2564f514074063d5039e21ba188e2a43
PeekabooProtocols      00f6fc7c6933764861c20f3f057cb755b6ac74e8
PeekabooAutomationKit  6451e2aac770b0c8a6f90868244b3ff879c8c392
PeekabooBridge         5088447b62ed91ae8a4e1402950322032ab99278
```

```bash
git -C /Users/jyp/Developer/t5-cu0-staging/peekaboo rev-parse \
  HEAD:Core/PeekabooFoundation/Sources/PeekabooFoundation \
  HEAD:Core/PeekabooProtocols/Sources/PeekabooProtocols \
  HEAD:Core/PeekabooAutomationKit/Sources/PeekabooAutomationKit \
  HEAD:Core/PeekabooCore/Sources/PeekabooBridge
```

## 라이선스

| 대상 | 라이선스 | PKG 고지 |
|---|---|---|
| Peekaboo | **MIT** (Peter Steinberger) | 필요 |
| AXorcist | **MIT** (Peter Steinberger) | 필요 |
| swift-log | Apache-2.0 (Apple) | 필요 |
| swift-algorithms | Apache-2.0 (Apple) | 필요 |

넣을 위치는 CU0 미결 항목이다(계획서 종료조건).

## 함께 둔 것

- `checksums-v3.9.10.txt` — 릴리스 자산 체크섬 4줄. **릴리스 바이너리용**이고 소스 핀과 별개다.
  우리는 바이너리를 안 쓰므로 참고용으로만 보관한다.

## 이 폴더를 어떻게 다루나

- **T5 저장소에 넣지 않았다.** 벤더링 여부는 CU0 결정 사항이다.
- 지우고 다시 받아도 위 좌표로 **같은 것이 나온다.**
- 업데이트는 upstream 을 따라가지 않는다 — 감사 후 이 문서의 좌표를 손으로 바꿀 때만 바뀐다.
