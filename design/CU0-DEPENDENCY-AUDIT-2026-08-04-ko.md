# CU0 사전감사 — 의존성·호환성·공급망

- 날짜: 2026-08-04
- 성격: **선행 준비**. T5 제품 코드·공용 파일·설계 문서 변경 **0건**. 작업 트리 밖에서만 밟았다.
- 대상: `design/T5-COMPUTER-USE-DEVELOPMENT-PLAN-2026-08-04-ko.md` §9 CU0 종료 조건
- 방법: `v3.9.10` 태그를 별도 디렉터리에 클론해 읽고, **라이브러리만 빌드**했다(§9).
  실행·시험은 하지 않았다.
- 소스 핀: ``design/CU0-SOURCE-PIN-v3.9.10-2026-08-04-ko.md``

---

## 0. 세 줄

1. **공급망은 깨끗하다.** 라이브러리 경로의 외부 의존은 `swift-log`·`swift-algorithms` 둘뿐이다.
   Tachikoma(AI provider)·MCP·네트워크 발신은 **그래프에도 코드에도 0** 이다.
2. **최소 OS 는 15 가 아니라 14 다 — 빌드로 확정했다.** 산출물에 `minos 14.0` 이 박혔고
   macOS 15+ 참조는 **0건**이다(§9). 계획서 결정 7·§3.4 를 고쳐야 한다.
3. **그러나 shell 은 안 사라진다.** 라이브러리 안에서 `osascript`·`screencapture`·`open`
   등 **6곳이 프로세스를 띄운다.** 그리고 T5 는 자기 샌드박스에서 `osascript` 를 막고 있다.
   계획서가 풀어야 할 정면 충돌이다.
4. **비공개 API 를 쓴다 — 두 계열.** CGS(WindowServer) 비공개 심볼 **20개는 게이트가 없고**,
   비공개 ScreenCaptureKit 창 조회는 **컴파일 플래그로 끌 수 있으나 기본이 켜짐**이다(§10).
   배포 안정성 결정 사항이다.

---

## 1. 공급망 — 원문 확인

| 항목 | 값 | 확인 방법 |
|---|---|---|
| 라이선스 | **MIT** (Copyright 2025 Peter Steinberger) | `LICENSE` 원문 |
| 릴리스 | **v3.9.10** · 2026-08-03 04:07 UTC | GitHub releases API |
| 커밋 | `eae9bfa69b15109b75e5bec1288bf901b51f0fa9` | **클론 `git rev-parse HEAD` 와 일치** |
| swift-tools | `6.2` · `swiftLanguageModes: [.v6]` | `Package.swift` 원문 |
| **platforms** | **`.macOS(.v14)`** | `Package.swift` 원문 |
| 배포 자산 | `.dmg` · `.app.zip` · `universal.tar.gz` · **`checksums.txt`** | releases API |

**provenance 확정** — 릴리스 API 가 준 커밋과 클론 HEAD 가 같다.

### 1.1 전이 의존 그래프 (라이브러리 경로만)

```
PeekabooFoundation      → (없음)
PeekabooProtocols       → PeekabooFoundation
PeekabooAutomationKit   → PeekabooFoundation, PeekabooProtocols,
                          AXorcist 0.1.6, swift-algorithms 1.2.1+
PeekabooBridge          → PeekabooAutomationKit, PeekabooFoundation

AXorcist 0.1.6 (MIT · .macOS(.v14) · openclaw/AXorcist)
   └─ 라이브러리 타깃 의존: swift-log 1.5.4+  ← 이것뿐
      (Commander 0.2.4 는 `axorc` **실행 타깃 전용** — 라이브러리 링크 시 안 들어온다)
```

**최종 외부 표면: `swift-log` · `swift-algorithms` 둘. 둘 다 Apple, Apache-2.0.**

`.gitmodules` 에 `Tachikoma`·`Commander`·`TauTUI`·`Swiftdansi` 가 서브모듈로 선언돼 있지만
**루트 매니페스트 그래프에 없다.** CLI·앱 타깃의 것이다.

### 1.2 네트워크 발신 — **0**

네 타깃 전체 grep:

- `dataTask` · `.data(for:` · `URLSession.shared` · `uploadTask` · `downloadTask` → **0건**
- `import Network` · `NWConnection` · `CFStream` → **0건**
- 유일한 흔적은 `Core/Utilities/NetworkErrorHandling.swift` 의 `extension URLSession`
  이고 **HTTP 오류 응답 디코딩 유틸**이다. 호출자는 같은 파일 안뿐 — **사실상 죽은 코드**다.

> 계획서 §6.4 "화면 내용은 데이터다" 와 §6.3 비밀 관점에서 **이 라이브러리는 화면을
> 밖으로 보내지 않는다.** 전송은 전적으로 T5 쪽 책임으로 남는다 — 좋은 경계다.

---

## 2. 계획서를 정정해야 할 것 ① — 최소 OS

계획서 결정 7·§3.4:

> 현재 T5의 macOS 최소 버전은 13이고 **Peekaboo v3는 15+**다. (…)
> 1차 Desktop Hand는 **macOS 15+**에서 활성화하고, 13·14에서는 `unsupported_os`

**근거를 나눠 보면 15 는 라이브러리 기준이 아니다.**

| 무엇 | 최소 OS | 출처 |
|---|---|---|
| released **CLI·앱** | 15+ | README 문장 |
| **SwiftPM 라이브러리** | **14** | `Package.swift` 원문 `.macOS(.v14)` |
| AXorcist | **14** | `Package.swift` 원문 |
| 참고: OpenAI Codex Computer Use (출하 제품) | **14.4** | `Info.plist` |

계획서는 라이브러리를 서명 호스트에 링크하겠다고 했다. **그러면 바닥은 14 다.**
13·14 중 **14 가 회수되고 13 만 남는다** — 사용자 모수가 바뀐다.

> **확정 아님.** `.v14` 선언과 14 에서의 실제 빌드·동작은 다르다(15 전용 API 분기,
> ScreenCaptureKit 경로, availability 심볼). **CU0 의 "source build + safe test" 를
> 15 뿐 아니라 14 로도 밟아야 확정된다.** §3.4 를 15 로 굳히기 전에 이걸 재는 값이 크다.

---

## 3. 계획서를 정정해야 할 것 ② — **shell 은 라이브러리 안에 있다**

계획서 결정 3:

> 자연어 `agent`, 외부 AI provider, **shell**, 외부 MCP 연쇄 기능은 제품 경로에서 제외한다.

CU0 종료 조건:

> release tool allowlist 에 agent/**shell**/provider/MCP-client/clipboard 없음

**agent·provider·MCP·clipboard 는 라이브러리 링크로 구조적으로 사라진다. shell 은 아니다.**

`PeekabooAutomationKit` 안의 프로세스 실행 자리 **6곳** (전수):

| 파일 | 줄 | 실행 대상 |
|---|---|---|
| `Services/UI/DockService+Actions.swift` | 161 | **`/usr/bin/osascript`** |
| `Services/Capture/LegacyScreenCaptureOperator+SystemScreencapture.swift` | 91 | **`/usr/sbin/screencapture`** |
| `Services/System/PermissionsService.swift` | 349 | **`/usr/bin/open`** |
| `Services/UI/DockService+Actions.swift` | 121 | `command.executable` (변수) |
| `Services/UI/DockService+Visibility.swift` | 49 | `launchPath` (변수) |
| `Services/UI/MenuService+MenuExtraWindows.swift` | 236 | `helperPath` (변수) |

소스 주석이 실행 대상을 직접 밝힌다 (`DockService+Process.swift:8`):

> Dock commands (`defaults`, `killall`, `osascript`) should never hang the CLI/MCP.

### 3.1 T5 자신과의 충돌

T5 샌드박스는 `osascript` 를 **막는다**. `src/runtime/sandbox.js:100` 주석 원문:

> 다른 앱을 원격 조종하는 통로. `osascript -e 'tell application …'` 한 줄이면 파일도 지우고

**즉 T5 는 자기 터미널에서 금지한 통로를 데스크톱 백엔드 안에서 쓰게 된다.**
숨기면 안 되는 사실이다. 선택지는 셋이다.

1. **경로별로 가른다** — capture/AX 는 쓰고, Dock·MenuExtra(`osascript`·`defaults`·`killall`)
   계열 API 는 T5 도구 표면에서 **부르지 않는다.** 그러면 실제 실행도 안 일어난다.
   (§4.1 `desktop.act` 의 동작 목록을 그 기준으로 좁히면 된다)
2. **서명 호스트 안에 가둔다** — 호스트가 실행하되 인자를 T5 가 고정하고, 임의 문자열이
   절대 안 들어가게 한다. 원장에 실행 사실을 남긴다.
3. **`screencapture` 는 legacy 경로다** — 파일명이 `LegacyScreenCaptureOperator` 다.
   ScreenCaptureKit 경로를 쓰면 이 자리는 안 탄다. **캡처 엔진 선택으로 회피 가능.**

> 어느 쪽이든 **"shell 없음"이라고 적으면 거짓**이 된다. 계획서 문구를
> "모델에게 임의 shell 을 열지 않는다 · 백엔드 내부 실행은 고정 인자로 원장에 남긴다"
> 로 정직하게 바꾸는 편이 맞다. (오너 원칙: 판정칸은 밟은 기계사실에서만)

---

## 4. 권한 소유 — 선례가 이미 오너 맥에 있다

계획서 결정 4(서명 호스트가 권한 소유, Node·npx 에 안 줌)를 **OpenClaw 가 이미 돌리고 있다.**
`skills/peekaboo/SKILL.md` 34~46행:

```
OpenClaw macOS 앱이 Peekaboo Bridge 를 호스팅:
  ~/Library/Application Support/OpenClaw/bridge.sock
CLI 는 자기 데몬을 안 띄우고 그 소켓으로 라우팅 → 앱의 권한을 그대로 씀
확인:  peekaboo bridge status --json  →  hostKind == "gui"
```

**T5 는 발명할 필요가 없다.** `PeekabooBridge` 를 서명된 T5 호스트에 링크하면 같은 구조가 되고,
Node 서버는 소켓 클라이언트가 된다 — 계획서 §3.3 브리지 신뢰 경계 그대로다.

### 4.1 권한 흐름 함정 (문서가 직접 경고)

> macOS 15+ 에서 **"bypass private window picker" 프롬프트는 기본 Screen Recording 권한과
> 별개**다. 브리지 권한이 정상이어도 뜰 수 있다.

CU8·CU9 에서 **관문 두 개**로 설계해야 한다. 하나로 보면 사용자가 "이미 허용했는데 왜 또"를 겪는다.

---

## 5. 서명·패키징 실물 참조 — `~/.codex/computer-use`

OpenAI 가 실제 출하한 서명 네이티브 호스트. CU8 직접 참조가 된다.

| 항목 | 값 | 시사 |
|---|---|---|
| `LSUIElement` | `true` | Dock 아이콘 없는 백그라운드 호스트 |
| `LSMinimumSystemVersion` | **14.4** | 상용도 14 대에서 출하 (§2 와 같은 방향) |
| TeamIdentifier | `2DC432GLL2` | 서명 주체 = 벤더 |
| entitlements | `automation.apple-events`, `personal-information.addressbook`, `application-groups`, `keychain-access-groups` | **Screen Recording·Accessibility 는 entitlement 가 아니다 — TCC 런타임 승인이다.** 착각하면 서명 설계가 틀어진다 |
| Usage 문구 | *"…only after you approve the recipient and message text"* | **OS 권한 카드 문구에 승인 경계를 적었다.** T5 자동성 헌장과 같은 사고 — 그대로 배울 것 |
| 동봉 | `Installer`(AuthorizationPlugin) · `Client`(cli) · **`LockScreenGuardian`** | 아래 |

- **`CUALockScreenGuardian`** — 화면 잠금 중 동작을 전담하는 프로세스를 따로 뒀다.
  계획서 §6.5 긴급 중지에 **잠금 화면 상태가 없다.** §10 반대시험 후보.
- **`AuthorizationPluginInstaller` 는 채택 제외.** macOS 인증 플러그인 설치는 시스템 보안 설정
  변경 계열이라 T5 안전 규율과 맞지 않는다. 참조만 한다.

---

## 6. CU0 종료 조건 대조

| 종료 조건 | 상태 | 근거 |
|---|---|---|
| 정확한 tag·commit·LICENSE 기록 | **충족** | §1 · 클론 해시 일치 |
| transitive dependency 기록 | **충족** | §1.1 — 최종 표면 `swift-log`·`swift-algorithms` |
| 사용 API 를 AutomationKit·Bridge·capture/AX 로 최소화 | **경로 확정** | 루트 매니페스트가 이미 라이브러리 4개만 낸다 |
| 제외 기능의 코드·환경·네트워크 경로 전수 열거 | **충족** | §1.2(네트워크 0) · §3(shell 6곳 전수) |
| release allowlist 에 agent/provider/MCP/clipboard 없음 | **구조적 충족** | 그래프에 없음 |
| release allowlist 에 **shell** 없음 | **미충족 — §3** | 라이브러리 내부 6곳 |
| macOS 15·arm64 source build + safe test | **미실행** | 빌드는 하지 않았다 |
| 재현 빌드 명령 + source hash 일치 | **부분** | 커밋 해시 일치 확인. `checksums.txt` 대조는 빌드 후 |
| license notice 를 PKG 에 넣을 위치 | **미결정** | 작업자·오너 결정 |
| 알려진 blocker 와 제거 비용 | **§7** | |

---

## 7. 남은 것과 비용

| # | 남은 것 | 비용 | 값 |
|---|---|---|---|
| 1 | **macOS 14 실제 빌드·동작** — §2 확정 | 중 | **가장 큼** (사용자 모수) |
| 2 | **shell 경로 결정** — §3 의 셋 중 택일 | 중 | 큼 (계획서 문구·§4.1 도구 표면이 따라 바뀜) |
| 3 | 15·arm64 source build + `checksums.txt` 대조 | 중 | 필수 |
| 4 | `swift-log`·`swift-algorithms` 라이선스 고지 위치 | 낮 | 필수 |
| 5 | 잠금 화면 상태 반대시험 추가 (§5) | 낮 | 중 |
| 6 | 권한 관문 2개 설계 (§4.1) | 낮 | 중 |

**이 맥은 macOS 26.3** — 15+ 빌드·시험은 여기서 되지만 **13·14 경로는 여기서 못 잰다.**
`unsupported_os` 검증에는 VM 또는 availability 정적 검사가 필요하다.

**brew formula(`steipete/tap/peekaboo`)는 제품 경로로 쓰면 안 된다** — 계획서의 런타임 다운로드
금지 조항에 걸린다. 소스 pin + 재현 빌드만 쓴다.

---

---

## 9. 빌드 확인 — macOS 14 는 확정이다 (컴파일 수준)

```
$ swift build --product PeekabooBridge
Build of product 'PeekabooBridge' complete! (60.04s)   # 476 유닛, exit 0, 경고성 실패 없음
```

- 툴체인: Apple Swift **6.2.4** (매니페스트 `swift-tools-version: 6.2` 와 일치) · SDK **26.2** · arm64
- 선언: `platforms: [.macOS(.v14)]`

**산출물에서 직접 읽은 값** (추론이 아니다):

```
$ otool -l …/PeekabooAutomationKit.build/*.o | grep -A4 LC_BUILD_VERSION
 platform 1
    minos 14.0        ← PeekabooAutomationKit
      sdk 26.2
    minos 14.0        ← PeekabooBridge
```

**가용성 분기 전수** (라이브러리 4타깃):

| 선언 | 건수 |
|---|---|
| `@available(macOS 14.0` | 14 |
| `#available(macOS 10.15` | 4 |
| `#available(macOS 14.2` | 2 |
| `#available(macOS 14.0` | 1 |
| `#available(macOS 13.0` | 1 |
| **`macOS 15` 이상** | **0** |

**15+ 참조가 한 건도 없다.** README 의 "macOS 15 or later" 는 배포 CLI·앱 이야기가 맞다.

`14.2` 두 자리는 사소하다 — 둘 다 `config.includeChildWindows = false` 한 줄이다
(`LegacyScreenCaptureOperator+Support.swift:117`, `+PrivateScreenCaptureKit.swift:56`).
**다만 14.0·14.1 에서는 창 캡처에 자식 창이 섞일 수 있다** — 계획서 §10 **A16**
(*"full desktop에 다른 사람 메시지 노출 → 기본 window scope 밖 캡처 0"*)에 직접 걸린다.
14.0·14.1 을 지원할 거면 이 경로에 T5 쪽 crop 보정이 필요하다.

### 9.1 아직 확정 아닌 것

**컴파일이 서는 것과 실제 14 기기에서 도는 것은 다르다.** 특히 §10 의 비공개 심볼은
런타임 결합이라 이 빌드로 증명되지 않는다. 이 맥은 macOS 26.3 이라 **여기서는 못 잰다.**
확정하려면 macOS 14 실기·VM 에서 관찰 탐침(CU1)을 한 번 밟아야 한다.

---

## 10. 비공개 API — 배포 안정성 결정 사항

빌드 중 발견. **계획서에 이 항목이 없다.**

### 10.1 CGS(WindowServer) 비공개 심볼 — **게이트 없음**

`Utilities/SpaceCGSPrivateAPI.swift` 가 `@_silgen_name` 으로 **20개**를 직접 바인딩한다.

```
_CGSDefaultConnection · CGSCopySpaces · CGSCopySpacesForWindows · CGSSpaceGetType
CGSGetActiveSpace · CGSSpaceCreate · CGSSpaceDestroy · CGSSpaceCopyName · CGSSpaceSetName
CGSAddWindowsToSpaces · CGSRemoveWindowsFromSpaces · CGSManagedDisplaySetCurrentSpace
CGSShowSpaces · CGSHideSpaces · CGSGetWindowLevel · …
```

- **`#if` 컴파일 게이트가 없다.** 무조건 빌드에 들어간다.
- 소비자: `Utilities/SpaceUtilities.swift`, `Services/UI/CGS/MenuBarCGSBridge.swift`
- 용도: Spaces(가상 데스크톱) 조작, 메뉴바 항목 접근

**위험** — 문서화되지 않은 심볼이라 macOS 업데이트에서 이름이 바뀌거나 사라지면
기능 저하가 아니라 **호출 시점 실패**가 된다. 오래 안정적이었던 표면이긴 하지만
**보장이 없다.** PKG 배포(공증)에서는 통상 막히지 않으나, App Store 경로는 별개다.

### 10.2 비공개 ScreenCaptureKit 창 조회 — **끌 수 있다**

`LegacyScreenCaptureOperator+PrivateScreenCaptureKit.swift` 는 이중으로 막을 수 있다:

```swift
#if PEEKABOO_DISABLE_PRIVATE_SCK_WINDOW_LOOKUP        // 컴파일에서 제거
    return false
#else
    if envFlagIsEnabled(environment["PEEKABOO_DISABLE_PRIVATE_SCK_WINDOW_LOOKUP"]) { return false }
    …
    return true                                        // ← 기본값이 켜짐
#endif
```

**T5 는 `-D PEEKABOO_DISABLE_PRIVATE_SCK_WINDOW_LOOKUP` 로 빌드해 구조적으로 없앨 수 있다.**
기본이 켜져 있으므로 **아무 것도 안 하면 켜진 채로 나간다** — 명시적 결정이 필요하다.

### 10.3 그래서 결정할 것

| 대상 | 선택지 |
|---|---|
| 비공개 SCK | **컴파일 플래그로 제거** (권장 — 비용 0, 공개 경로로 대체됨) |
| CGS Spaces | ① 그대로 두고 위험을 원장·릴리스 노트에 기록 ② Spaces·메뉴바extra 기능을 `desktop.*` 에서 빼고 링크만 감수 ③ 핀한 소스에서 해당 파일을 걷어내고 그 기능을 포기 |

**어느 쪽이든 "비공개 API 없음"이라고 적으면 거짓이다.** §3 의 shell 과 같은 성격이다.

---

## 11. 이 문서가 하지 않은 것

- **실행·시험을 하지 않았다.** 빌드만 했다. §9.1 대로 macOS 14 실기 동작은 미확정이다.
- Peekaboo 를 T5 에 등록하지 않았다. T5 파일을 만들거나 고치지 않았다.
- §3(shell)·§10(비공개 API)의 선택지 중 무엇을 고를지 정하지 않았다 — 계획 소유자·오너의 결정이다.
