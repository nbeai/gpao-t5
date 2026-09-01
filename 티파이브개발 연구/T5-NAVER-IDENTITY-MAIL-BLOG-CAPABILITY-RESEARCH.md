# T5 Naver Identity·Mail·Blog Capability 연구·개발 계획

기록일: 2026-09-01
조사 기준: T5 NX `9e2daf0c` 및 과거 Naver 실제 설치본 증거
상태: `RESEARCH_COMPLETE · OWNER_GATE_OPEN · NV0_COMPLETE · NV1_COMPLETE · NV1R_COMPLETE · NV2_COMPLETE · NV3_BROWSER_LOGIN_ACTUAL_PASS_MAIL_READ_CURRENT · IMAP_CANDIDATE_REJECTED_BY_OWNER_UX · PRODUCT_IMPLEMENTATION_GATE_OPEN`

NV-1 현재 상태: `COMPLETE`. A 미선택은 restart 뒤 Mail·Blog login_required, B 선택은 같은 profile·restart 뒤
둘 다 ready였다. 실제 여정에서 발견된 restart provider continuity P1도 NV-1R에서 수리·실제 재자격했다.
사용자 완료 문장:

> 사용자는 T5가 연 네이버 창에서 한 번 직접 로그인하고, T5는 같은 네이버 신분을 정확히 보존해 메일을 찾고 읽고
> 첨부를 전달하며, 블로그 원고를 제목·본문·카테고리·태그·이미지·서식·예약 상태까지 실제 화면에서 준비한다.
> 메일 발송과 블로그 공개·예약 발행은 현재 대상과 내용을 다시 보여주고 사용자가 맡긴 범위에서 정확히 한 번만
> 실행하며, 재시작·탭 종료·화면 변경 뒤에도 다른 브라우저 현실을 만들거나 성공을 꾸미지 않는다.

이 문서는 현재 `T5-NX.md` Gate를 자동 변경하지 않는 연구 계획이다. 오너는 Naver Gate를 열었으며, 현재 정본의
NV-2 한 단계만 제품 구현할 수 있다.

## NX-2 공통 승격 계약

NX-2 귀속: `NX2-6 — Naver Identity·Mail·Blog Native Work`

로그인·메일·블로그 각각의 자동화가 동작했다는 사실만으로 완료하지 않는다. 제품 승격에는 다음이 모두 필요하다.

- 하나의 T5 Naver identity와 authority 아래 Mail protocol·Blog Browser·후속 authenticated collection이 결속된다.
- 메일 검색·첨부·답장·전송과 블로그 초안·craft·예약·발행의 실제 사용자 목적이 end-to-end로 완료된다.
- draft·send·save·schedule·publish·public reopen을 서로 다른 실제 effect로 보존한다.
- 일반 비밀번호·cookie·app password가 모델·Prompt·로그·guest code에 노출되지 않는다.
- ACK unknown·로그인 만료·2FA·화면 변경·restart에서 중복 전송·중복 발행·가짜 성공이 없다.
- 기존 Direct·Web·Browser 요청을 느리게 하거나 raw Selenium/agent-browser의 두 번째 현실을 만들지 않는다.
- 현재 수동 작업 및 T5 자연 경로와 wall·round·사용자 클릭·교정 부담·결과 품질을 비교한다.
- 실제 Console에서 입력→진행→Preview→교정→외부 effect→재개방→후속 사용을 확인한다.

한국 자영업자에게 유용하다는 주장이나 기능 수는 승격 근거가 아니다. 실제 Mail·Blog 인간 HQ에서 더 빠르고 정확하며
안전하고 사용하기 쉬워야 한다.

---

## 1. 결론

가능하다. 다만 메일과 블로그를 Selenium 한 덩어리로 자동화하면 과거 실패를 반복한다.

정답 구조는 다음 세 경로의 분리다.

```text
Naver Identity Broker
├─ Naver Mail Protocol Hand     IMAP·SMTP
├─ Naver Blog Browser Hand     현재 Naver UI
└─ Naver Authenticated Read Broker   후속 crawler 확장
```

- **Identity**: T5가 소유하는 전용 Browser profile과 사용자 visible login handoff.
- **Mail**: 공식 IMAP·SMTP가 기본. Browser UI는 설정·복구·공식 프로토콜 미지원 기능에만 사용.
- **Blog**: 글쓰기 Open API가 종료됐으므로 T5 Browser Hand가 실제 UI를 관측·입력·재관측.
- **Crawler**: raw cookie를 모델이나 외부 script에 넘기지 않고, 별도 qualified broker가 선 뒤에만 로그인된 대량 수집.

Selenium·webdriver-manager는 현재 Managed Playwright를 대체하는 정답이 아니다. Windows 물리 자격에서 Playwright가
실제로 실패할 때만 같은 Browser Hand 아래의 provider 후보로 비교한다. 모델에는 언제나 `browser` 하나만 보인다.

---

## 2. 공식 현실과 과거 증거

### 2.1 네이버 로그인 상태 유지

Naver 공식 도움말은 로그인 화면에서 `로그인 상태 유지`를 선택하면 브라우저 쿠키 삭제·로그아웃 전까지 로그인 상태가
유지되며, 2주 동안 해당 PC에서 Naver를 사용하지 않으면 해제될 수 있다고 설명한다.

- https://help.naver.com/service/5640/contents/19013
- 개인 정보 보호 모드처럼 쿠키를 저장하지 않는 Browser에서는 사용할 수 없다.
- 신뢰하는 Browser에서 2단계 인증 생략을 선택할 수 있으며 쿠키 삭제·기기 변경·설정 취소 시 다시 인증한다.
  - https://help.naver.com/service/5640/contents/9236

따라서 과거 T5의 clean restart 뒤 `login_required`는 Browser profile 결함으로 단정할 수 없다. 당시 사용자가
`로그인 상태 유지`와 신뢰 Browser를 선택했는지 증거가 없으므로 opposing test가 필요하다.

### 2.2 네이버 메일 공식 경로

Naver는 IMAP·SMTP를 공식 제공한다.

- IMAP: `imap.naver.com:993`, SSL
- SMTP: `smtp.naver.com:587`, TLS
- Naver Mail 설정에서 IMAP/SMTP를 `사용함`으로 전환해야 한다.
- 2025-06-24 이후 신규 외부 메일 연결은 2단계 인증과 애플리케이션 비밀번호가 필요하다.
- 일반 계정 비밀번호를 T5가 받거나 저장해서는 안 된다.

공식 근거:

- https://help.naver.com/service/30029/contents/21351
- https://help.naver.com/notice/noticeView.help?noticeNo=22533&serviceNo=30021

메일은 UI scraping보다 protocol connection이 정확성·속도·유지보수에서 우선한다.

### 2.3 네이버 블로그 공식 경계

Naver 블로그 글쓰기 Open API는 반복적 기계 발행과 정책 위반 문제로 2020-05-06 종료됐다.

- https://developers.naver.com/notice/article/7527

현재 공식 UI에는 제목·본문·카테고리·주제·공개 범위·태그·현재/예약 발행이 있다.

- https://help.naver.com/service/5593/contents/15541

따라서 현재 블로그 작성은 Browser UI가 실제 경로다. 과거 종료 API를 되살리거나 숨은 endpoint를 제품 계약으로
사용하지 않는다.

### 2.4 T5 과거 실제 증거

1. 0.1.1 대화별 visible profile에서 실제 Naver 로그인·메일 읽기 성공.
2. 0.1.2 공용 persistent host가 stale pinned target과 `tab_gone` 반복을 만듦.
3. raw `agent-browser`가 Terminal PATH에서 T5 관리 profile과 다른 Browser reality를 만들어 로그인 오판.
4. Naver Blog 초기 우회는 2분 29초·model 21·Tool 20·866,015 tokens.
5. 범용 `editables → fill_editable → 재관측` Hand는 32초·model 7·Tool 6·49,579 tokens·exec 0.
6. 제목 32자·본문 8,053자 실제 재관측 일치, save·publish·submit 0.
7. clean app restart 뒤 session-only cookie는 복원되지 않아 login_required.
8. 0.1.7에서 profile identity와 disposable process/window/tab/CDP를 분리하고 `tab_gone` 1회 재결속,
   login window close를 user cancellation로 정산.

근거:

- `T5-REFOUNDATION.md#P0-H1`
- `refoundation/evidence/p0-h1-browser-provider-qualification-2026-08-22.json`
- `refoundation/evidence/p0-h1-0.1.3-rc-installed-live-2026-08-23.json`
- `refoundation/evidence/p0-browser-lifecycle-0.1.7-installed-2026-08-24.json`

---

## 3. 제품 원리

### 3.1 하나의 Naver 신분

```text
지속
- profile identity
- 사용자 선택으로 생성된 장기 login state
- service connection state
- last qualified observation

일회성
- Chrome process
- window
- tab
- frame
- DOM ref
- CDP binding
```

- 사용자의 평소 Chrome profile을 붙이지 않는다.
- Mail·Blog·Crawler가 서로 다른 profile을 만들지 않는다.
- raw `agent-browser`, Selenium script, T5 Browser가 같은 계정을 각각 로그인하지 않는다.
- 모델·Tool result·log에 cookie·localStorage·ID/PW·OTP를 노출하지 않는다.
- 매 Run의 로그인 상태는 현재 페이지나 protocol probe로 다시 관측한다.

### 3.2 하나의 Browser Hand, 교체 가능한 provider

```text
model surface: browser
        ↓
Naver Browser contract
        ↓
Managed Playwright provider — 기본
Selenium provider — Windows qualification 후보
```

Selenium 후보는 다음을 모두 이길 때만 채택한다.

- 동일 profile 연속성
- 로그인 handoff
- iframe/editor exact observation
- stale tab·modal·new tab identity
- Stop·restart·cleanup
- Chrome update 후 driver readiness
- wall·calls·실패율

`webdriver-manager`의 장점은 Chrome/driver 호환 준비다. 정식 제품은 branch/latest download를 실행 중 임의 사용하지 않고,
pinned provider version·digest 또는 설치본 Browser runtime으로 자격한다.

### 3.3 API·protocol 우선, UI는 필요한 곳만

```text
Mail read/search/send
→ IMAP/SMTP

Mail 설정·특수 UI
→ Browser

Blog 작성·서식·이미지·예약·발행
→ Browser
```

UI 자동화가 가능하다는 이유로 메일 목록·본문을 Browser로 긁지 않는다.

---

## 4. Naver Identity Broker

### 4.1 상태 모델

```yaml
schema: t5.naver-identity.v1
profileHandle:
state: not_started | login_required | user_control | authenticated | expired | cancelled | failed
services:
  mailWeb: unknown | ready | login_required
  blogWeb: unknown | ready | login_required
  mailProtocol: unknown | setup_required | ready | needs_reauth
profileGeneration:
lastObservedAt:
browserProcess: absent | running
currentHandoff: null | active | completed | cancelled
```

public projection에는 raw profile path·cookie·ID·token을 내보내지 않는다.

### 4.2 로그인 흐름

```text
Naver 작업 요청
→ current login_status read-only probe
→ login_required
→ browser login_start exact Naver HTTPS URL
→ 사용자 ID·PW·OTP 직접 입력
→ 사용자가 원하면 로그인 상태 유지·신뢰 Browser 선택
→ user returns
→ Mail 또는 Blog read-only positive control
→ authenticated receipt
```

고정 60초 sleep을 쓰지 않는다. 사용자 완료·창 닫힘·현재 페이지·timeout의 실제 사건으로 정산한다.

### 4.3 Opposing test

같은 계정·profile에서 두 회차를 비교한다.

```text
A: 로그인 상태 유지 미선택
B: 로그인 상태 유지 선택
```

각 회차:

1. login_start
2. Mail read-only positive control
3. T5·관리 Browser clean shutdown
4. Runtime 재시작
5. same profile Mail read-only probe
6. Blog home read-only probe

쿠키를 추출하지 않고 `ready/login_required`만 기록한다. B가 실제로 유지돼야 장기 로그인 완료를 주장한다.

---

## 5. Naver Mail Protocol Hand

### 5.1 연결

사용자 준비:

1. Naver Mail의 IMAP/SMTP를 `사용함`.
2. Naver 2단계 인증 설정.
3. Naver 애플리케이션 비밀번호 생성.
4. T5 secret input surface에 앱 비밀번호 입력.

T5는 일반 Naver 비밀번호를 요구하지 않는다.

구현 후보:

- Node `imapflow` pinned dependency
- Node `nodemailer` pinned dependency
- app password는 `platform-secret-store`
- 설정 metadata와 credential은 분리
- connection probe는 IMAP mailbox list와 SMTP authenticated no-send 또는 provider-supported verify

### 5.2 action contract

```text
mail.status
mail.list_folders
mail.search
mail.read
mail.download_attachment
mail.create_draft
mail.reply_draft
mail.send
```

- list/search/read/download는 observe.
- draft는 managed local artifact 또는 provider draft가 실제로 생성된 경우 external_change.
- send는 external_send. 수신자·제목·본문·첨부 exact preview와 delivery result를 보존한다.
- timeout/ACK unknown 뒤 blind resend 0.
- 같은 messageId·recipient·content digest의 current Run 중복 send 0.

### 5.3 Mail 완료 증거

- 검색 조건과 반환 coverage
- exact message identity·folder·receivedAt
- 본문 관측 범위
- 첨부 bytes·mime·digest
- draft readback
- send terminal result
- 보낸메일함 exact readback 또는 `delivery_unknown`

---

## 6. Naver Blog Browser Hand

### 6.1 action contract

```text
blog.status
blog.open_editor
blog.inspect_draft
blog.fill_title
blog.fill_body
blog.set_category
blog.set_tags
blog.apply_format
blog.insert_images
blog.set_visibility
blog.set_schedule
blog.save_draft
blog.preview
blog.publish
blog.reopen_post
```

모델에는 Naver CSS selector나 Selenium command를 노출하지 않는다. provider가 current observation의 exact control identity를
사용한다.

### 6.2 Blog Draft Contract

```yaml
schema: t5.naver-blog-draft.v1
sourceArtifact:
title:
bodySource:
category:
tags:
visibility:
schedule: null | ISO local datetime
images:
  - artifactHandle:
    insertionAnchor:
format:
  emphasis:
  dividers:
  headings:
expectedReadback:
```

- Markdown 원고와 이미지의 exact Artifact identity·digest를 사용한다.
- 모델이 8,000자 본문을 Tool args에 다시 복사하지 않는다.
- title/body/category/tag/image/format/schedule을 각각 실제 editor에서 재관측한다.
- 일부 필드 실패를 전체 성공으로 합치지 않는다.

### 6.3 서식·이미지

- text offset이 아니라 editor block identity와 selected text digest를 우선한다.
- 같은 단어가 여러 번 등장하면 occurrence·block·surrounding text로 결속한다.
- 이미지 파일 선택창이 남아 있거나 upload ACK가 unknown이면 완료가 아니다.
- color·font size·divider는 적용 후 rendered DOM/style 또는 visible readback을 관측한다.
- editor가 구조를 바꾸면 stale control을 재사용하지 않는다.

### 6.4 저장·예약·발행

```text
fill all fields
→ draft readback
→ Preview
→ user correction
→ save/schedule/publish effect
→ editor/post readback
```

- `save_draft`: 실제 draft 목록 또는 editor save state 재관측.
- `set_schedule`: 날짜·시간·timezone 재관측.
- `publish`: 공개 범위·카테고리·태그·예약/즉시·title digest를 effect 전에 다시 결속.
- submit ACK가 사라지면 같은 글을 blind publish하지 않는다.
- published URL과 title/body excerpt를 재개방해야 terminal success다.

---

## 7. Authenticated Collection Broker — 후속 Gate

현재 web-crawler Skill은 로그인된 수집에서 raw Browser cookie를 외부 script로 복사하지 않도록 막혀 있다.

Naver Identity가 선 뒤 다음 두 후보를 비교한다.

### 후보 A — Browser provider 안에서 수집

- 같은 Naver profile과 Browser process
- provider가 허용된 exact Naver origin의 read-only requests/DOM을 수행
- cookie 원문 외부 노출 0
- 대량 수집에는 비효율 가능

### 후보 B — scoped request broker

- crawler는 URL·method·bounded request만 제출
- broker가 같은 profile session에서 대상 Naver origin 요청
- cookie/header 원문 반환 0
- response bytes·host·status·coverage receipt
- write method·cross-origin·secret endpoint 차단

raw cookie export, Selenium profile 복제, 사용자의 평소 Chrome attach는 후보가 아니다.

---

## 8. Progress·UX

사용자 표면:

```text
로그인이 필요해요
→ 네이버 로그인 창 열림
→ 로그인 확인 중
→ 메일을 찾는 중 / 블로그 초안을 준비 중
→ 제목·본문·이미지 확인됨
→ 발행 전 확인
→ 저장됨 / 예약됨 / 발행됨 / 확인 필요
```

- model 사고·selector·cookie·CDP log를 노출하지 않는다.
- login handoff와 current task progress를 한 상태처럼 섞지 않는다.
- main Stop은 current Work와 child Browser action을 정리한다.
- 사용자가 login window를 닫으면 재개방하지 않고 `user_control_cancelled`.
- 다른 대화로 이동해도 Work와 Browser handoff 상태가 보존된다.

---

## 9. 파일 책임 계획

### 새 파일 후보

| 파일 | 책임 |
|---|---|
| `refoundation/src/naver-identity-broker.js` | 하나의 profile identity·login handoff·current status·restart |
| `refoundation/src/naver-mail-connection.js` | IMAP/SMTP metadata·secret readiness·probe |
| `refoundation/src/naver-mail-tool.js` | search/read/attachment/draft/send action contract |
| `refoundation/src/naver-blog-adapter.js` | editor observation·field/action mapping·readback |
| `refoundation/src/naver-blog-tool.js` | draft·format·image·schedule·publish Hand |
| `refoundation/src/naver-session-broker.js` | 후속 logged-in collection scoped broker |
| `refoundation/config/naver-browser-incidents.json` | 과거 실제 실패와 UI counterexample |

### 기존 파일 최소 변경

| 파일 | 변경 |
|---|---|
| `agent-browser-driver.js` | Naver profile owner·restart current truth; provider 일반성 유지 |
| `browser-observation-tool.js` | 새 Naver action을 직접 넣기보다 adapter가 existing primitives를 사용 |
| `connection-state-store.js` | mail protocol readiness metadata |
| `platform-secret-store.js` | app password secret owner |
| `console-server.js` | deferred Naver capability discovery·tool composition |
| `capability-reality.js` | mail/blog/browser readiness 분리 |
| `work-completion-evaluator.js` | send/publish unknown·missing readback 기존 blocker 재사용 |
| `artifact-preview.js` | blog draft Preview가 필요한 경우 기존 Artifact 재사용 |
| `skill-catalog.json` | 사용 방법은 default가 아니라 capability가 실제 ready일 때만 노출 |

Browser core를 Naver selector로 오염시키지 않는다. Naver UI knowledge는 adapter·incident fixture에 둔다.

---

## 10. 개발 Gate

### NV-0 — Current Reality Baseline

- 과거 실제 evidence와 current Browser code 감사
- 현재 Naver Mail·Blog UI read-only actual
- 공식 API/protocol 재확인
- product source delta 0

### NV-1 — Login Persistence Opposing Test

- 로그인 상태 유지 미선택/선택 AB
- Mail·Blog read-only
- clean app/browser restart
- cookie 원문 관측 0

완료: 선택 회차가 재시작 후 실제 authenticated이면 persistent identity 후보 채택. 둘 다 실패하면 cookie 복사 patch를
붙이지 않고 Broker/profile lifecycle을 재판정한다.

### NV-2 — Naver Identity Broker

- one profile owner
- login_start/status/cancel
- tab/process disposable
- stale target one retry
- raw agent-browser exec 0

### NV-3 — Mail Read

- IMAP/SMTP setup UX
- app password secret input
- folder/search/read/attachment
- restart·needs_reauth

현재 상태: `BROWSER_LOGIN_CURRENT · IMAP_CANDIDATE_REJECTED_BY_OWNER_UX`. 공식 IMAP 후보는 별도 2단계 인증·IMAP
설정·앱 비밀번호 발급과 입력을 사용자에게 요구해 T5의 기본 경험을 악화했고 실제 연결도 인증 단계에서 실패했다. 제품
입력면·dependency·Tool은 제거하며 Git 역사에만 실패 증거로 보존한다. 설정의 `네이버 로그인`은 기존 managed persistent
Browser의 공식 로그인 화면을 열고, 완료 뒤 같은 profile에서 Mail·Blog를 각각 read-only 재관측한다.

오너 actual 결과: `LOGIN_AND_DUAL_SERVICE_READBACK_PASS`. 설정의 `네이버 로그인`으로 공식 로그인 화면을 열고 사용자가
직접 로그인한 뒤 `로그인 완료 확인`이 Mail·Blog 연결 성공을 보고했다. credential field·cookie/secret 관측·두 번째
Browser reality는 0이다. 이제 같은 실제 Console에서 Mail list/search/open/attachment를 자격한다.

첫 Mail actual에서 설정 owner와 대화 Session이 서로 다른 isolated profile을 사용해 로그인 화면이 다시 열리는 P1이
재현됐다. 제품 entry를 기존 자격된 `PersistentBrowserHost`에 결속해 하나의 profile identity를 공유하고, 대화별 client
session·pinned tab은 계속 분리한다. 실제 Browser 반대시험에서 다른 대화와 host restart 뒤 로그인 유지·서로 다른 tab
identity를 통과했다. 오너의 기존 설정 로그인 profile을 공통 profile로 승계한 뒤 Mail actual을 다시 실행한다.

### NV-4 — Mail Draft & Send

- draft preview
- recipient/subject/body/attachment exact binding
- send terminal·unknown·보낸메일함 readback
- duplicate send 0

### NV-5 — Blog Draft Core

- editor open/new tab adoption
- title/body/category/tag
- long body path/digest binding
- actual readback

### NV-6 — Blog Craft

- Markdown source
- heading/emphasis/color/font size/divider
- image insertion
- Preview·partial failure

### NV-7 — Save·Schedule·Publish

- draft save
- visibility
- schedule date/time
- publish exact once
- published post reopen

### NV-8 — Authenticated Collection Broker

Naver Mail·Blog이 안정된 뒤 web-crawler의 logged-in Naver collection을 같은 identity에 결속한다.

### NV-HQ — 자영업자 실제 인간 자격

- 전체 기능 첫 pass
- 발견 P0/P1 수리
- clean second pass
- exact installed candidate
- macOS와 Windows 분리

---

## 11. RED 반대시험

### Identity

1. login 유지 미선택 뒤 restart.
2. login 유지 선택 뒤 restart.
3. cookie 삭제·로그아웃·2주 inactivity simulation.
4. 사용자가 login window 닫음.
5. stale tab·new tab·Chrome 전체 종료.
6. 과거 assistant 로그인 문장을 current truth로 오인.
7. raw agent-browser·Selenium이 다른 profile을 관측.
8. 두 Session이 같은 profile의 다른 tab ref를 공유.

### Mail

1. IMAP 설정 off.
2. 일반 비밀번호 제출.
3. 앱 비밀번호 revoked.
4. 2FA needs setup.
5. 검색 0건·부분 coverage.
6. 큰 첨부·잘못된 mime.
7. SMTP timeout before/after ACK.
8. 같은 send retry.
9. 보낸메일함 readback 지연.

### Blog

1. popup/modal로 editor 가림.
2. 새 글 탭이 둘 이상 생김.
3. hidden aria buffer를 editable로 오인.
4. title 첫 줄에 body가 들어감.
5. category·tag 하나만 실패.
6. 색상 log success지만 actual style 불변.
7. 짧은 divider/긴 divider 혼동.
8. 동일 강조 단어 여러 occurrence.
9. 이미지 upload 후 file chooser 잔류.
10. schedule calendar locale·month boundary·timezone.
11. save/publish ACK unknown.
12. publish 후 URL reopen 실패.
13. user Stop 직후 late publish.
14. Chrome update 뒤 provider mismatch.

---

## 12. 성능 목표

현재 과거 positive control을 기준으로 한다.

- 이미 로그인된 Mail search/read: model 2회 이내, 필요한 protocol call bounded, first useful 10초 이내 목표.
- Blog editor ready: 15초 이내 목표.
- title + 8,000자 body + readback: 과거 32초 positive control 이하.
- category·tags·image·format을 포함한 draft Preview: 60초 이내 목표.
- 재시작 후 login 상태 probe: 5초 이내 목표.
- 사용자가 로그인하는 시간은 T5 처리 wall과 분리.

목표 미달 자체가 P0는 아니지만 현재 T5보다 느리고 질문·클릭이 늘면 채택하지 않는다.

---

## 13. 인간 HQ 시나리오

### Mail

1. “지난주 세무사 메일 찾아서 첨부 내려받아줘.”
2. “거래처 A의 미답장 메일만 요약해줘.”
3. “이 파일을 첨부해서 답장 초안 만들어줘.”
4. “보내줘.” → exact recipient/content 확인·send·보낸메일함 readback.
5. 앱 재시작 후 같은 검색 재개.

### Blog

1. “이 MD 원고를 내 블로그 초안으로 옮겨줘.”
2. 제목·본문·카테고리·태그 실제 readback.
3. 지정 단어 색상·크기와 긴 구분선.
4. 이미지 3개를 지정 위치에 삽입.
5. 비공개 초안 저장·재개방.
6. 내일 오전 9시 예약 Preview.
7. 사용자 교정 뒤 예약 발행.
8. 발행 URL 재개방.
9. 중간 Stop·재시작·다른 대화 전환.

### 인간 체감

- 사용자는 Python·Selenium·driver·selector·cookie를 보지 않는다.
- 로그인 필요·현재 입력·검증·발행 대기가 구분된다.
- 실패 필드와 성공 필드를 분리해 보여준다.
- 발행 전 사용자가 무엇이 나갈지 한 화면에서 이해한다.
- 같은 일을 다시 맡길 의향과 현재 수작업 대비 절감 시간을 기록한다.

---

## 14. 패키지·플랫폼

- macOS·Windows는 같은 Naver Hand 계약을 사용한다.
- Browser provider binary·version·profile path는 platform adapter가 맡는다.
- profile은 앱 bundle이 아니라 사용자 state에 둔다.
- upgrade가 profile을 지우지 않는다.
- uninstall은 앱과 profile/credential 보존·삭제 선택을 분리한다.
- 설치본 smoke test는 Browser launch·profile write·login_start surface까지만 합성 fixture로 자동화한다.
- 실제 Naver 계정은 owner-controlled human HQ에서만 사용한다.
- Selenium provider를 포함한다면 driver/runtime의 exact version·digest·license·remove/rollback을 payload에 넣는다.

---

## 15. 중단선

- Mail protocol이 가능한데 Mail UI scraping을 기본으로 만든다.
- raw agent-browser·Selenium CLI가 T5 Browser와 다른 profile reality를 만든다.
- cookie를 모델·Tool result·Python script·log에 노출한다.
- Naver 일반 비밀번호를 chat이나 T5 Secret Store에 보관한다.
- Blog selector 예외를 Browser core에 계속 추가한다.
- 같은 editor 결함에 세 번째 selector patch가 필요하다.
- success log를 actual field/style/post readback 없이 완료로 사용한다.
- timeout 뒤 mail send·publish를 blind retry한다.
- 로그인 유지 실패를 cookie 파일 복사로 즉시 덮는다.
- 모델마다 Naver Prompt나 Tool schema를 따로 만든다.
- package·Windows·Naver 실제 계정 결과를 서로 이전한다.

---

## 16. 커밋 순서

1. `Freeze Naver identity and protocol baselines`
2. `Qualify persistent Naver login identity`
3. `Bind Naver Mail through IMAP and SMTP`
4. `Settle Naver Mail send exactly once`
5. `Observe and fill Naver Blog drafts`
6. `Verify Naver Blog craft and images`
7. `Settle Naver scheduling and publication`
8. `Broker authenticated Naver collection`
9. `Qualify Naver capability in the actual product`

한 커밋에서 Mail·Blog·Crawler를 함께 열지 않는다.

---

## 17. 최종 합격식

```text
하나의 Naver profile identity
AND login 상태 유지 선택의 actual restart continuity
AND Mail IMAP/SMTP exact connection
AND Mail search/read/attachment/draft/send truth
AND Blog title/body/category/tag/image/style/schedule readback
AND send/publish duplicate 0
AND Stop·restart·tab loss·Chrome update recovery
AND credential/cookie model exposure 0
AND raw second Browser reality 0
AND macOS human HQ PASS
AND Windows human HQ PASS 또는 명시 deferred
AND clean second whole-flow pass
```

완료 문장:

> T5는 대한민국 사용자의 하나의 네이버 신분을 안전하게 유지하고, 메일은 공식 protocol로 빠르고 정확하게 처리하며,
> 블로그는 실제 화면을 관측해 전문적인 원고·서식·이미지·예약·발행을 끝낸다. 사용자는 로그인과 최종 외부 효과만
> 통제하고 Python·Selenium·쿠키·selector를 배우지 않는다.
