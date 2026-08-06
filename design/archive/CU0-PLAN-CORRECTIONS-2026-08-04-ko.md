# 컴퓨터 유즈 계획서 정정 지시서

- 날짜: 2026-08-04
- 대상: `design/T5-COMPUTER-USE-DEVELOPMENT-PLAN-2026-08-04-ko.md` (상태 `DRAFT_FOR_OWNER_APPROVAL`)
- 근거: `design/CU0-DEPENDENCY-AUDIT-2026-08-04-ko.md` (소스 원문 대조)
- 소스 핀: ``design/CU0-SOURCE-PIN-v3.9.10-2026-08-04-ko.md``
- **지시서일 뿐이다.** 계획서를 고치지 않았다 — 소유자가 반영한다.

정정은 **다섯 건**이다. ①②는 사실 정정, ③은 상태 갱신, ④⑤는 추가다.

---

## ① 결정 3 — "shell 제외"는 사실이 아니다 (34행)

**지금**

```
3. 첫 백엔드는 MIT 라이선스의 **Peekaboo 네이티브 라이브러리·브리지**를 고정 버전으로 감사해 사용한다.
   자연어 `agent`, 외부 AI provider, shell, 외부 MCP 연쇄 기능은 제품 경로에서 제외한다.
```

**바꿀 것**

```
3. 첫 백엔드는 MIT 라이선스의 **Peekaboo 네이티브 라이브러리·브리지**를 고정 버전으로 감사해 사용한다.
   자연어 `agent`, 외부 AI provider, 외부 MCP 연쇄 기능은 **의존성 그래프에서 제외된다** —
   라이브러리 4타깃(`PeekabooFoundation`·`PeekabooProtocols`·`PeekabooAutomationKit`·
   `PeekabooBridge`)이 그것들을 참조하지 않으므로 allowlist 가 아니라 빌드에서 빠진다.
   **shell 은 다르다.** `PeekabooAutomationKit` 내부가 프로세스를 띄우는 자리가 6곳 있다.
   여섯을 성격별로 가르면 **다섯이 사라지고 하나만 남는다**(아래 표). 따라서 계약은 이렇게 선다 —
   **모델에게 임의 shell 을 열지 않는다. 백엔드 내부 실행은 `/usr/bin/open -g -b <bundleId>`
   하나뿐이며, 인자를 T5 가 고정하고 원장에 남긴다.**
```

**왜** — 라이브러리 소스 실측. **T5 는 자기 샌드박스에서 `osascript` 를 막고 있다**
(`src/runtime/sandbox.js:100`). 숨기면 안 된다.

### ①-1 여섯 자리 전수와 권고

여섯을 열어 보면 한 덩어리가 아니다.

| 자리 | 실제로 하는 것 | 권고 |
|---|---|---|
| `Services/System/PermissionsService.swift:349` | `/usr/bin/open -g -b <bundleId>` — 앱을 백그라운드로 연다 | **유지** |
| `Services/UI/DockService+Actions.swift:121` | `/usr/bin/killall Dock` | **제외** |
| `Services/UI/DockService+Actions.swift:161` | `/usr/bin/osascript` (Dock 조작) | **제외** |
| `Services/UI/DockService+Visibility.swift:49` | `/usr/bin/killall Dock` | **제외** |
| `Services/UI/MenuService+MenuExtraWindows.swift:236` | 메뉴바 extra 헬퍼 | **제외** |
| `Services/Capture/LegacyScreenCaptureOperator+SystemScreencapture.swift:91` | `/usr/sbin/screencapture` | **회피** |

**제외가 타협이 아닌 이유** — Dock 계열 셋은 `defaults write com.apple.dock` + `killall Dock`,
즉 **독 구성을 바꾸는 시스템 설정 변경**이다. **T5 안전 규율이 이미 금지하는 범주**라
고민할 자리가 아니라 `desktop.act` 동작 목록에 **넣으면 안 되는 것**이다.
그리고 **Dock 을 빼면 `osascript` 세 자리 중 두 자리가 같이 사라진다** — 샌드박스 충돌이 없어진다.

**유지하는 하나** — `/usr/bin/open -g -b <bundleId>` 는 인자가 고정이고 사용자 문자열이 들어가지
않으며 셸 해석도 없다. 그리고 **권한 안내 흐름에 필요한 물건**이다(설정 앱을 열어 사용자가
권한을 주게 하는 자리). 슬라이스 A 에서 쓴다.

**회피** — 캡처는 ScreenCaptureKit 경로를 기본으로 둔다. 파일명이 `Legacy…` 인 자리다.
이 결정은 슬라이스 F 라 늦출 수 있다.

### ①-2 권고 (결정은 계획 소유자)

> **선택지 1(경로별로 가른다)을 기본으로, 남는 하나에만 3(고정 인자 + 원장)을 적용.**
> **결과: `osascript` 0 · `killall` 0 · `defaults` 0.**

**2(호스트 안에 가둔다)를 기본으로 삼는 것은 권하지 않는다.** 위험한 것을 껴안은 채 관리하겠다는
뜻인데, 지금은 껴안을 필요가 없다.

---

## ② 결정 7 · §3.4 — 최소 OS 는 15 가 아니라 14 다 (40~42행, 153~171행)

**지금 (40~42행)**

```
7. 현재 T5의 macOS 최소 버전은 13이고 Peekaboo v3는 15+다. **앱 전체 최소 버전을 조용히 올리지 않는다.**
   1차 Desktop Hand는 macOS 15+에서 활성화하고, 13·14에서는 T5의 나머지 기능을 유지하며 SelfState가
   `unsupported_os`와 가능한 대안을 정확히 말한다.
```

**바꿀 것**

```
7. 현재 T5의 macOS 최소 버전은 13이다. **앱 전체 최소 버전을 조용히 올리지 않는다.**
   Peekaboo 의 "macOS 15+" 는 **배포되는 CLI·앱**의 요구사항이고, 우리가 링크할
   **SwiftPM 라이브러리는 `Package.swift` 가 `.macOS(.v14)` 로 선언한다**(AXorcist 도 14.0).
   따라서 1차 Desktop Hand 의 목표 바닥은 **14** 로 두고, 13 만 `unsupported_os` 로 보낸다.
   **CU0 에서 빌드로 확인했다** — 산출물 `minos 14.0`, 라이브러리 4타깃에 macOS 15+ 참조 0건.
   **단 실기 동작은 별개다** — CU1 관찰 탐침을 macOS 14 실기·VM 에서 한 번 밟아 확정한다.
   14.0·14.1 은 창 캡처에 자식 창이 섞일 수 있으므로(§9) T5 쪽 crop 보정 여부를 함께 정한다.
```

**§3.4 제목·본문도 같이** — `### 3.4 macOS 13·14 정책` → `### 3.4 macOS 13 정책과 14 확정 절차`.
본문 첫 줄 *"1차 릴리스는 macOS 15+에서 네이티브 손을 제공한다"* → *"1차 릴리스의 목표 바닥은 14다
(CU0 빌드 확인). 13에서는:"* 로 하고 이하 목록은 그대로 둔다.

**왜** — 기계 사실이다.

```
swift build --product PeekabooBridge   →  exit 0 (476유닛, 60초)
otool -l …/*.o | grep LC_BUILD_VERSION →  minos 14.0   (AutomationKit·Bridge 둘 다)
가용성 분기 전수                        →  macOS 15+ 참조 0건 (최고 14.2, 두 자리뿐)
```

README 의 "macOS 15 or later" 는 **배포 CLI·앱**의 요구사항이다. AXorcist 도 `.macOS(.v14)`, MIT.
참고로 OpenAI 가 출하한 Codex Computer Use 도 `LSMinimumSystemVersion = 14.4` 다.

---

## ②-2 §3.1 · CU0 — **비공개 API 항목이 계획서에 없다** (신규)

계획서 §3.1 "채택하지 않는 부분" 과 CU0 작업 항목에 **비공개 API 조항을 신설해야 한다.**
빌드 중 발견했고, 지금 계획서 어디에도 없다.

**추가할 것 (§3.1 채택하지 않는 부분)**

```
- **비공개 ScreenCaptureKit 창 조회** — `-D PEEKABOO_DISABLE_PRIVATE_SCK_WINDOW_LOOKUP`
  로 컴파일에서 제거한다. **기본값이 켜짐이므로 아무 것도 안 하면 켜진 채 나간다.**
```

**추가할 것 (CU0 작업·종료조건)**

```
- 비공개 심볼 표면을 전수 기록한다. 현재: `Utilities/SpaceCGSPrivateAPI.swift` 가
  `@_silgen_name` 으로 CGS(WindowServer) 비공개 심볼 **20개**를 바인딩하며 **컴파일 게이트가 없다**
  (소비자: `SpaceUtilities.swift`, `MenuBarCGSBridge.swift`).
- 셋 중 하나를 정하고 근거를 적는다:
  ① 유지하고 위험을 릴리스 노트·진단 원장에 기록
  ② Spaces·메뉴바extra 를 `desktop.*` 에서 제외하고 링크만 감수
  ③ 핀한 소스에서 제거하고 해당 기능 포기
```

**왜** — 문서화되지 않은 심볼이라 macOS 업데이트에서 사라지면 **기능 저하가 아니라 호출 실패**다.
오래 안정적이었지만 보장이 없다. **어느 쪽을 고르든 "비공개 API 없음"이라고 적으면 거짓이다** — ①의 shell 과 같은 성격이다.

### ②-2-1 호출 경계 실측

**CGS 호출이 두 파일 안에 갇혀 있다.** 라이브러리 안 다른 어디에서도 부르지 않는다
(전수 grep 확인). **창 목록·앱 목록 경로에 걸리지 않는다.**

```
Utilities/SpaceUtilities.swift          class SpaceManagementService
    getAllSpaces · getCurrentSpace · getSpacesForWindow · switchToSpace
    · moveWindowToSpace · getWindowLevel · …            ← 전부 Spaces 조작
Services/UI/CGS/MenuBarCGSBridge.swift  메뉴바 extras (앱 메뉴와 다른 물건)
```

**슬라이스 A~F 어디에도 Spaces 가 필요 없다.** 부르지 않으면 돌지 않는다.

### ②-2-2 권고 (결정은 계획 소유자)

> **②(기능 제외 + 링크만 감수)를 기본으로 한다. 단 A 에서 아래 둘을 검증한다.**

**③(소스에서 걷어내기)은 권하지 않는다.** 파일을 지우는 순간 **포크를 유지하게 된다** —
업데이트마다 리베이스 부담이 생기고 *"감사 후 pin 변경만 허용"* 이라는 규율이 깨진다.
**안 부르면 안 도는 코드를 위해 낼 비용이 아니다.**

**①(유지하고 위험만 기록)도 권하지 않는다.** 기능을 노출한다는 뜻이고, 그러면 심볼이 실제로
호출된다. 나중 macOS 에서 깨지면 **사용자 손에서** 터진다.

**A 에서 검증할 것 둘**

1. **최종 실행본 링크가 서는가 — 아직 미검증이다.**
   CU0 에서 한 것은 **라이브러리 빌드라 링크 단계가 없었다.** `@_silgen_name` 으로 선언한
   비공개 심볼이 실행본을 만들 때 실제로 풀리는지는 **재보지 않았다.** 서명 호스트 실행본을
   만들 때 여기서 처음 드러난다. **링크가 안 서면 그때는 ③(포크)밖에 없다 — 조건부다.**
2. **T5 쪽에 그물을 건다.**
   ```
   검사: SpaceManagementService · MenuBarCGSBridge 가 T5 코드 어디에서도 인스턴스화되지 않는다
   ```
   나중에 누가 Spaces 전환을 배선하면 검사가 잡는다. **고친 것보다 그것을 지키는 그물이
   없는 것이 문제였다** — 이 저장소가 반복해서 배운 것이다.

---

## ③ §2.2 선행조건 4 — 충족됨 (76행)

**지금**

```
4. 의존성 감사 결과와 정확한 upstream commit/tag가 동결된다.
```

**바꿀 것**

```
4. ~~의존성 감사 결과와 정확한 upstream commit/tag가 동결된다.~~
   **충족(2026-08-04)** — `design/CU0-DEPENDENCY-AUDIT-2026-08-04-ko.md` · 핀 `CU0-SOURCE-PIN-v3.9.10-2026-08-04-ko.md`.
   tag `v3.9.10` / commit `eae9bfa69b15109b75e5bec1288bf901b51f0fa9` /
   AXorcist `dbafbe3a…` (exact 0.1.6). 라이브러리 경로 외부 표면은
   `swift-log`·`swift-algorithms` 둘뿐이고 **네트워크 발신 0**.
```

**§9 CU0 종료조건(483행)도 같이**

```
- release tool allowlist에 agent/shell/provider/MCP-client/clipboard 없음
```
→
```
- release tool allowlist에 agent/provider/MCP-client/clipboard 없음 — **의존성 그래프로 충족**
- shell: 모델 노출 0 · 백엔드 내부 실행은 고정 인자 + 원장 기록 (①의 결정 반영)
```

---

## ④ §10 반대시험 — 두 줄 추가 (708~731행 표)

```
| A21 | 화면 잠금 상태에서 행동 요청 | 실행 0, 잠금 사실을 SelfState·사용자에게 정확히 말함 |
| A22 | 행동 도중 화면 잠김 | 진행 중 동작 중단, 부분 효과를 원장에 정직하게 기록 |
```

**왜** — OpenAI Codex Computer Use 가 `CUALockScreenGuardian.app` 을 **별도 프로세스로** 뒀다.
잠금 화면은 GUI 자동화에서 따로 다뤄야 하는 상태라는 뜻이다. 현재 §6.5 긴급 중지에 이 상태가 없다.

> A14(`event dispatch 성공, 화면 변화 없음 → 성공 영수증 0`)는 **이미 있다.** 좋다 —
> 원장 진실 계약의 GUI판이 이미 반대시험으로 서 있다.

---

## ⑤ §3.3 브리지 신뢰 경계 · CU8 — 두 가지 사실 반영

**(가) 권한 소유 구조에 선례가 있다**

OpenClaw 가 이미 같은 구조를 돌린다 — 앱이 Bridge 를 `~/Library/Application Support/OpenClaw/bridge.sock`
에 호스팅하고, CLI 는 자기 데몬을 안 띄우고 그 소켓으로 라우팅해 **앱의 권한을 쓴다**.
확인 수단도 있다: `bridge status --json` 의 `hostKind == "gui"`.
**T5 는 발명하지 않는다. `PeekabooBridge` 를 서명 호스트에 링크하면 같은 구조다.**

**(나) 권한 관문은 하나가 아니라 둘이다**

> macOS 15+ 에서 **"bypass private window picker" 프롬프트는 기본 Screen Recording 권한과 별개**다.
> 브리지 권한이 정상이어도 뜰 수 있다.

CU8·CU9 권한 흐름을 **관문 2개**로 설계한다. 하나로 보면 사용자가 "이미 허용했는데 왜 또"를 겪는다.

**(다) 서명 설계 주의 — entitlement 와 TCC 를 섞지 말 것**

Codex Computer Use 의 서명 entitlements 는 `automation.apple-events`,
`personal-information.addressbook`, `application-groups`, `keychain-access-groups` 다.
**Screen Recording·Accessibility 는 entitlement 가 아니라 TCC 런타임 승인이다.**
서명 설계에서 이걸 섞으면 통째로 틀어진다.

> `AuthorizationPluginInstaller` 는 **따라가지 않는다.** macOS 인증 플러그인 설치는
> 시스템 보안 설정 변경 계열이라 T5 안전 규율과 맞지 않는다. 참조만.

---

## 반영 후 남는 것

| # | 남은 것 | 상태 |
|---|---|---|
| 1 | macOS 14 빌드 확인 (②) | **완료** — `minos 14.0`, 15+ 참조 0건. 실기 동작은 CU1 |
| 2 | shell 경로 결정 (①) | **권고 있음**(①-2). 소유자 승인 대기 |
| 3 | 비공개 CGS 결정 (②-2) | **권고 있음**(②-2-2). 소유자 승인 대기 |
| 4 | **최종 실행본 링크에서 CGS 심볼이 풀리는가** | **미검증.** 슬라이스 A 에서 처음 드러난다 |
| 5 | 라이선스 고지를 PKG 어디에 | 미결. Peekaboo MIT · AXorcist MIT · swift-log/algorithms Apache-2.0 |
| 6 | 벤더링 여부(저장소에 넣을지) | 미결. 지금은 저장소 밖 |

**2·3 은 권고를 적었을 뿐 결정하지 않았다.** 계획 소유자가 승인하거나 다른 것을 고르면
그 판단을 여기 적고 근거를 남긴다.

**4 가 유일한 미지수다.** 여기서 링크가 안 서면 ②-2-2 의 권고(②)가 무너지고 ③(포크)로 간다.

소스와 빌드는 `/Users/jyp/Developer/t5-cu0-staging/peekaboo` 에 있다 —
**T5 저장소 밖이라 진행 중인 작업에 영향이 없다.**

---

## 관련 문서

```
design/T5-COMPUTER-USE-DEVELOPMENT-PLAN-2026-08-04-ko.md   ← 정정 대상 (정본)
design/CU0-DEPENDENCY-AUDIT-2026-08-04-ko.md               ← 이 정정의 근거
design/CU0-SOURCE-PIN-v3.9.10-2026-08-04-ko.md             ← 소스 고정 좌표
design/CU0-SLICING-PROPOSAL-2026-08-04-ko.md               ← 관찰 전용부터 자르는 순서 제안
```
