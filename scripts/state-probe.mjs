#!/usr/bin/env node
// 칸 0 · 상태 계측기 — T5 의 기관 상태를 **코드에서 직접 떠서** 낸다.
//
// 닫는 문장: `design/T5-FINAL-ASSEMBLY-ko.md` §2「지금 상태」를 **사람이 손으로 안 고쳐도 된다.**
//
// 왜 있나: 오늘 PM 계획서가 하루에 세 번 틀렸다 — A5(이미 닫힘) · A1(과잉 진단) · A6(오분류).
// 전부 코드 대조 없이 옛 문서를 옮긴 탓이다. **문서는 낡지만 스크립트는 안 낡는다.**
//
// 규율 넷:
//   · 기계 사실만 적는다 — 추정·해석·판정을 적지 않는다(계측기는 판정하지 않는다. 종료 코드 항상 0).
//   · 부재를 주장하려면 **무엇을 찾았는지**(검색어·경로·훑은 파일 수)를 함께 낸다(F-56).
//   · 계획서가 요구하는 동사는 아래 `기관규격` 한 곳에만 있다 — 계획서가 바뀌면 여기만 고친다.
//   · 유료 모델 호출 0 · 실기기 접촉 0 · 오너 실사용 자리(`~/.local/state/gpao-t5`) 접촉 0.
//
// 쓰기: `node scripts/state-probe.mjs` (사람이 읽는 표) · `--json` (기계 판독용)
import { mkdtemp, readFile, readdir, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const 저장소 = dirname(dirname(fileURLToPath(import.meta.url)));
const 계획서 = 'design/T5-FINAL-ASSEMBLY-ko.md';

// ─────────────────────────────────────────────────────────────────────────────
// 기관 규격 — 계획서 §4「기관 지도 열」의 **상한**을 그대로 옮긴 단 하나의 자리.
//
// 여기 적힌 것은 *요구*이고, *있는 것*은 전부 코드에서 뜬다. 계획서 §4 가 바뀌면
// **이 상수만** 고친다(하드코딩을 코드 곳곳에 뿌리지 않는다).
//
// 요구 항목의 근거 토큰 셋:
//   손:'id:verb' 또는 'id'   — 손 인벤토리(descriptor 의 action enum)에서 확인
//   채널:'name:op' 또는 'name' — 모델 통제 채널(model-control.js)에서 확인
//   부품:'key'                — 아래 `부재규격` 의 부재 확인 결과에서 확인
// ─────────────────────────────────────────────────────────────────────────────
const 기관규격 = Object.freeze([
  {
    key: 'file', 번호: '①', name: '파일·폴더',
    상한: '찾기·읽기·쓰기·옮기기·지우기·되돌리기·버전·묶음이동',
    계획서층: '✅ 완결 — 손대지 않는다',
    요구: [
      { 요구: '찾기', 손: ['local.file:list'] },
      { 요구: '읽기', 손: ['local.file:read'] },
      { 요구: '쓰기', 손: ['local.file:write'] },
      { 요구: '옮기기', 손: ['local.file:move'] },
      { 요구: '지우기', 손: ['local.file:delete'] },
      { 요구: '되돌리기', 손: ['local.file:undo'] },
      { 요구: '버전', 손: ['local.file:versions'] },
      { 요구: '묶음이동', 손: ['local.file:bulk_move'] },
    ],
  },
  {
    key: 'terminal', 번호: '②', name: '터미널·프로세스',
    상한: '명령·켜기·끄기·상태·로그',
    계획서층: '✅ 완결 — 손대지 않는다',
    요구: [
      { 요구: '명령', 손: ['local.terminal'] },
      { 요구: '켜기', 손: ['local.process:start'] },
      { 요구: '끄기', 손: ['local.process:stop'] },
      { 요구: '상태', 손: ['local.process:status'] },
      { 요구: '로그', 손: ['local.process:logs'] },
    ],
  },
  {
    key: 'time', 번호: '③', name: '시간',
    상한: '제안·확정·정지·재개·관찰',
    계획서층: '✅ 완결 (실경로 3/3 · 2026-08-11)',
    요구: [
      { 요구: '제안', 채널: ['automation.propose'] },
      { 요구: '확정', 채널: ['automation.control:commit'] },
      { 요구: '정지', 채널: ['automation.control:pause'] },
      { 요구: '재개', 채널: ['automation.control:resume'] },
      { 요구: '관찰', 채널: ['automation.observe', 'automation.control:status'] },
    ],
  },
  {
    key: 'web-read', 번호: '④', name: '웹(읽기)',
    상한: '검색·수집 (로그인 뒤는 ⑤의 몫)',
    계획서층: '✅ 완결 — 손대지 않는다',
    요구: [
      { 요구: '검색', 손: ['web.search'] },
      { 요구: '수집', 손: ['web.collect'] },
    ],
  },
  {
    key: 'screen-hand', 번호: '⑤', name: '화면 손',
    상한: '새 동사 추가 없음 — 있는 17개를 쓰게 하는 일이다',
    계획서층: '층 3 — 능력 있음 / 모델이 모름(성질 1) / 자기보고 거짓(성질 2)',
    // 상한이 "새 동사 추가 없음" 이므로 **요구 = 이미 선언된 것**이다.
    // 그래도 공허하지 않게 만든다: 계획서 §4⑤ 「있음」 줄이 이름으로 부른 것들을
    // 실제 enum 값에 1:1 로 걸어 두면, 그 중 하나라도 지워지면 여기가 먼저 빨개진다.
    요구: [
      { 요구: '창 앞으로', 손: ['desktop.act:focus'] },
      { 요구: '옮기기', 손: ['desktop.act:move'] },
      { 요구: '크기', 손: ['desktop.act:resize'] },
      { 요구: '앱 켜기', 손: ['desktop.act:launch'] },
      { 요구: '앱 끄기', 손: ['desktop.act:quit'] },
      { 요구: '창 안 글자 읽기', 손: ['desktop.screen:observe'] },
      { 요구: '버튼 누르기', 손: ['desktop.act:click'] },
      { 요구: '칸에 글자 넣기', 손: ['desktop.act:type'] },
      { 요구: '키', 손: ['desktop.act:press_key'] },
      { 요구: '단축키', 손: ['desktop.act:hotkey'] },
      { 요구: '메뉴', 손: ['desktop.act:menu'] },
      { 요구: '스크롤', 손: ['desktop.act:scroll'] },
      { 요구: '화면 그림 생성', 손: ['desktop.screen:observe'] },
    ],
    // 계획서가 이름으로 부르는데 enum 에 1:1 로 걸 수 없는 말 — **숨기지 않고 적는다.**
    // 있다고도 없다고도 하지 않는다(F-56). 사람이 계획서 문구를 고칠지 손을 열지 정한다.
    모호: [{ 계획서표현: '내리기', 왜: 'desktop.act enum 에 minimize 계열 동사가 없다' }],
  },
  {
    key: 'browser-hand', 번호: '⑥', name: '브라우저 손',
    // ── 상한이 **뒤집혔다**(2026-08-11 · 실측이 PM 결정을 뒤집었다) ─────────────
    // 여기 적혀 있던 「정밀 읽기 전용 · 타이핑은 안 여는 것이 설계」는 PM 결정이었고,
    // 그 결정이 틀렸다는 것을 기계 사실이 보였다: 네이버 과업에서 브라우저 손으로 열고
    // 글자를 치려니 **화면 손(픽셀)으로 돌아갔고 승인 카드 2장**이 떴다 — 「사용자 손 0회」가
    // 깨진 자리가 정확히 거기다. 비교군 둘(OpenClaw `browser-control`, Hermes `browser_type`)은
    // 브라우저가 **스냅샷 ref 위에서** 직접 친다.
    //
    // **경계는 그대로다.** 열린 것은 ref 위의 타이핑과 **검색 칸의 엔터**뿐이고,
    // 보안 칸·파일 칸·폼 제출·전송·구매는 여전히 이 손에 없다.
    상한: '정밀 읽기 + ref 위 타이핑 — 이동·스냅샷·스크롤·탭 전환·뒤로·텍스트 추출/요소 목록'
      + ' · 보안 칸이 아닌 칸에 글자 치기 · 검색 칸에서 엔터.'
      + ' 보안 칸·파일 올리기·폼 제출·전송·구매는 열지 않는다',
    계획서층: '1(신축) + 의도된 봉인',
    요구: [
      { 요구: '이동', 손: ['browser.observe:open', 'browser.act:navigate'] },
      { 요구: '스냅샷', 손: ['browser.observe:snapshot'] },
      { 요구: '스크롤', 손: ['browser.act:scroll'] },
      { 요구: '탭 전환', 손: ['browser.act:tab', 'browser.act:switch_tab'] },
      { 요구: '뒤로', 손: ['browser.act:back'] },
      // 2026-08-11 신설 — 닫는 문장(네이버 검색)이 이 둘 없이는 손 0회로 안 끝난다.
      { 요구: '타이핑', 손: ['browser.act:type'] },
      { 요구: '검색 엔터', 손: ['browser.act:press'] },
      // 정밀 읽기의 알맹이 둘 — action enum 이 아니라 **관찰 결과 칸**이라 부품으로 확인한다.
      { 요구: '텍스트 추출', 부품: 'browser-text-extract' },
      { 요구: '요소 목록', 부품: 'browser-element-list-to-model' },
    ],
    주의: '타이핑이 요구로 들어왔다 — 예전 「안 여는 것이 설계」는 PM 결정이었고 실측이 뒤집었다'
      + '(승인 카드 2장이 뜬 자리 · 2026-08-11).'
      + ' 요소 목록은 **반쪽이다**: OBSERVE_SCRIPT 가 링크·버튼·탭을 40개까지 모으는데'
      + '(browser.js `actionable`), 모델에게 가는 것은 탭·펼침 12개뿐이다'
      + '(browser-tool.js `canOpen` 이 role==="tab" 또는 expanded 만 남긴다).'
      + ' 링크·버튼은 모아 놓고 안 준다 — 부재가 아니라 **전달에서 잘린다.**',
  },
  {
    key: 'channel', 번호: '⑦', name: '채널',
    상한: '조회 동사 1 + 왕복. 첨부·미디어·그룹 관리·읽음 표시는 밖',
    계획서층: '2 — 순수 배선',
    요구: [
      { 요구: '보내기(텔레그램)', 손: ['telegram.send'] },
      { 요구: '보내기(슬랙)', 손: ['slack.post'] },
      { 요구: '보내기(메일)', 손: ['mail.send'] },
      { 요구: '받은 것 조회', 손: ['telegram.inbox', 'slack.inbox', 'mail.inbox', 'channel.inbox'] },
    ],
  },
  {
    key: 'document-create', 번호: '⑧', name: '문서 만들기',
    상한: 'xlsx(표·수식 없음·서식 최소) · pdf(A4·인쇄 가능) · docx. 이 셋 밖은 이번 프로그램 아님',
    계획서층: '1 — 유일한 진짜 신축. 대체 수단 없음',
    요구: [
      // ★ **형식별로 가른다**(F-104 · 2026-08-12). 첫 판은 셋을 한 부품('document-create')에
      // 걸어 놨다 — 그래서 xlsx 표지를 더하자 **pdf·docx 까지 「있음」으로 뒤집혔다**.
      // 부재를 잘못 선언한 자를 고치다 **반대로 눈멀게 한** 자리다. 형식마다 자기 자를 갖는다.
      { 요구: 'xlsx 만들기', 부품: 'xlsx-create' },
      { 요구: 'pdf 만들기', 부품: 'pdf-create' },
      { 요구: 'docx 만들기', 부품: 'docx-create' },
    ],
  },
  {
    key: 'image', 번호: '⑨', name: '그림',
    상한: 'local.file 이 이미지 파일을 읽으면 그림으로 실린다. ⑧과 한 세트',
    계획서층: '2 — 나르는 길은 있고 집는 손이 없다',
    요구: [
      { 요구: '화면 그림 → 모델', 부품: 'model-image-intake' },
      { 요구: '사용자 파일 이미지 → 모델', 부품: 'user-image-to-model' },
    ],
  },
  {
    key: 'connector', 번호: '⑩', name: '외부 서비스 커넥터',
    상한: '이번 몫은 **측정까지만** — 한 항목을 끝까지 걸어보고 결과를 기록한다',
    계획서층: '와이어·카탈로그 설계는 있고 한 항목도 실제로 안 걸어봄',
    요구: [
      { 요구: '선언 손', 부품: 'connector-hands' },
      { 요구: '연결 손', 부품: 'connector-hands' },
    ],
    주의: 'connector.declare·connector.connect 는 live-context.js 에서만 배선된다 —'
      + ' demo/격리 방의 손 인벤토리와 모델 노출 목록에는 **아예 안 나온다.**'
      + ' 여기 「있음」은 코드 존재이지 모델이 쥔다는 뜻이 아니다.',
  },
]);

// ─────────────────────────────────────────────────────────────────────────────
// 부재 규격 — **없음을 주장하려면 무엇을 찾았는지 함께 낸다**(F-56: 관측 안 됨 ≠ 부재).
//
// 검색어를 두 갈래로 나눈다:
//   생성전용  그 말이 나오면 **만드는 부품**이라고 볼 수 있는 것 → `found`
//   모호      읽기에도 쓰이는 말 → `ambiguous` 로 file:line 까지 내서 사람이 직접 본다
//
// ── ★ 양성 대조 — **부재는 이것 없이 선언하지 못한다** (F-104 · 2026-08-12) ──────────
//
// 이 자가 2026-08-12 에 **오보를 냈다**: `document-create` 검색어가 전부 외부 라이브러리
// 이름(`exceljs`·`pdf-lib`·`sheetjs`…)이라, 라이브러리 없이 자체 구현한 T5 의 xlsx 생성기를
// 못 보고 0건을 냈다. 그 0 이 「기관 ⑧ 문서 만들기 = 없음」으로 출력돼 **지도와 계획서가
// 받아 적었다.** 실제로는 `document-intake.js:buildXlsx` 가 진짜 엑셀을 만든다.
//
// **「0」이 「없다」인지 「안 봤다」인지 자가 스스로 구분해야 한다.** 그래서 규격마다
// **실재하는 것을 이 검색법으로 잡아 보이는 대조**를 함께 둔다. 대조가 안 걸리면 그 줄은
// 「없다」가 아니라 **「이 자로는 못 본다」**로 나간다 — 다음 사람이 부재로 안 읽는다.
//
// 오너 2026-08-12: *"그 맨날 틀리는 자 좀 어떻게 해봐라."* 고백이 아니라 구조로 답한다.
// 같은 병을 제품에서 이미 두 번 고쳤다 — S2(부재가 안전의 증거로 읽힘) · J6(절단을 다 봤다로 읽음).
// ─────────────────────────────────────────────────────────────────────────────
const 부재규격 = Object.freeze([
  {
    subject: 'xlsx-create',
    질문: 'xlsx 를 **만드는** 부품이 있나',
    경로: ['src', 'scripts', 'bin', 'vendor', 'package.json'],
    // T5 는 라이브러리를 안 쓴다 — zip 을 직접 짜고(buildXlsx) 표 본문을 행으로 나눈다(표행들).
    생성전용: ['buildXlsx', '표행들', 'exceljs', 'excel4node', 'xlsx-populate', 'sheetjs', 'XLSX.write'],
    모호: ['xlsx'],
    양성대조: { 말: 'buildXlsx', 자리: 'src/runtime/document-intake.js', 검색어로잡힌다: true,
      왜: '자체 구현 xlsx 생성기를 이 검색법이 실제로 잡는 것을 보인다' },
  },
  {
    subject: 'pdf-create',
    질문: 'pdf 를 **만드는** 부품이 있나',
    경로: ['src', 'scripts', 'bin', 'vendor', 'package.json'],
    생성전용: ['buildPdf', 'cupsfilter', 'printToPDF', 'pdf-lib', 'jspdf', 'pdfmake', 'wkhtmltopdf'],
    모호: ['pdf', 'PDFKit'],
    // ★ **부재가 아니었다**(F-104 · 2026-08-12). 내가 「pdf 없다」로 두 번 적었는데,
    // 이 자를 고치자 `src/skills/pdf-docx/SKILL.md` 가 나왔다 — 손이 아니라 **스킬**로 있다.
    // 자를 고친 값이 이것이다: 자가 **나를 정정했다.**
    양성대조: { 말: 'cupsfilter', 자리: 'src/skills/pdf-docx/SKILL.md', 검색어로잡힌다: true,
      왜: 'pdf 생성은 스킬 파일로 실재한다 — 이 검색법이 그것을 잡는 것을 보인다' },
  },
  {
    subject: 'docx-create',
    질문: 'docx 를 **만드는** 부품이 있나',
    경로: ['src', 'scripts', 'bin', 'vendor', 'package.json'],
    생성전용: ['buildDocx', 'textutil', 'docxtemplater', 'officegen', 'new Packer'],
    모호: ['docx'],
    // ★ 같은 자리 — docx 도 스킬로 있다(textutil).
    양성대조: { 말: 'textutil', 자리: 'src/skills/pdf-docx/SKILL.md', 검색어로잡힌다: true,
      왜: 'docx 생성은 스킬 파일로 실재한다 — 이 검색법이 그것을 잡는 것을 보인다' },
  },
  {
    subject: 'document-create',
    질문: 'xlsx·pdf·docx 를 **만드는** 부품이 있나',
    경로: ['src', 'scripts', 'bin', 'vendor', 'package.json'],
    생성전용: ['exceljs', 'pdf-lib', 'jspdf', 'pdfmake', 'officegen', 'docxtemplater', 'excel4node',
      'xlsx-populate', 'sheetjs', 'XLSX.write', 'XLSX.utils.book_new', 'new Packer', 'wkhtmltopdf',
      'printToPDF', 'libreoffice', 'soffice', 'pandoc',
      // ★ **자체 구현 표지** — 이것이 없어서 오보가 났다(F-104). T5 는 라이브러리를 안 쓴다:
      //   xlsx 는 zip 을 직접 짜고(buildXlsx), 표 본문을 행으로 나눈다(표행들).
      //   외부 이름만 찾는 자는 우리가 만든 것을 영영 못 본다.
      'buildXlsx', '표행들'],
    모호: ['PDFKit', 'PDFDocument', 'xlsx', 'docx', 'hwp'],
    // ★ 오보를 낸 자리. 검색어가 외부 라이브러리뿐이라 **자체 구현을 못 봤다**.
    양성대조: { 말: 'buildXlsx', 자리: 'src/runtime/document-intake.js', 검색어로잡힌다: true,
      왜: 'T5 는 라이브러리 없이 xlsx 를 짓는다 — 그 구현을 이 검색법이 실제로 잡는 것을 보인다' },
  },
  {
    subject: 'user-image-to-model',
    질문: '사용자 **파일** 이미지를 모델에게 실어 보내는 길이 있나',
    // 파일을 집는 손들만 본다 — 화면 손(desktop-*)은 이미 있는 길이라 여기서 세지 않는다.
    경로: ['src/runtime/local-file.js', 'src/runtime/document-intake.js', 'src/runtime/local-locate.js',
      'src/runtime/capsule.js', 'src/runtime/file-scope.js'],
    생성전용: ['그림:', 'image_url', 'input_image', 'inlineData', 'media_type', 'toBase64Image'],
    모호: ['image/', '.png', '.jpg', 'jpeg', 'base64'],
    // 진짜 부재다. 그래서 **같은 말이 실재하는 자리**에서 이 검색법이 무는 것을 보인다.
    양성대조: { 말: 'image_url', 자리: 'src/runtime/model-provider.js', 검색어로잡힌다: true,
      왜: '같은 검색어가 모델 쪽 그림 통로는 잡는다 — 그러므로 파일 손 쪽 0건은 진짜 부재다' },
  },
  {
    subject: 'model-image-intake',
    질문: '그림을 모델에게 실어 보내는 **소비 지점**이 있나 (계획서: 세 공급자 블록)',
    경로: ['src/runtime/model-provider.js', 'src/runtime/chatgpt-model-client.js'],
    생성전용: ['image_url', 'input_image', 'inlineData', 'media_type'],
    모호: [],
    양성대조: { 말: 'inlineData', 자리: 'src/runtime/model-provider.js', 검색어로잡힌다: true,
      왜: '세 공급자 블록 중 하나를 이 검색법이 실제로 잡는 것을 보인다' },
  },
  {
    subject: 'connector-hands',
    질문: 'connector.declare · connector.connect 손이 코드에 있나',
    경로: ['src'],
    생성전용: ['makeConnectorDeclareTool', 'makeConnectorConnectTool'],
    모호: ['connector.declare', 'connector.connect'],
    양성대조: { 말: 'makeConnectorConnectTool', 자리: 'src/runtime/connector-connect.js', 검색어로잡힌다: true,
      왜: '손 팩토리 이름 검색이 실재하는 팩토리를 잡는 것을 보인다' },
  },
  {
    subject: 'browser-text-extract',
    질문: '스냅샷이 페이지 **텍스트**를 함께 내고, 그것이 모델 영수증까지 가나',
    경로: ['src/runtime/browser.js', 'src/runtime/browser-tool.js'],
    // 생산(OBSERVE_SCRIPT 가 글을 담는가)과 전달(영수증에 실리는가)을 같이 본다.
    생성전용: ['textTotal', 'body?.innerText', 'markdown:'],
    모호: ['text:', 'excerpt'],
    양성대조: { 말: 'textTotal', 자리: 'src/runtime/browser.js', 검색어로잡힌다: true,
      왜: '본문 글자를 담는 칸을 이 검색법이 실제로 잡는 것을 보인다' },
  },
  {
    subject: 'browser-element-list-to-model',
    질문: '브라우저가 모은 **요소 목록이 모델에게 그대로** 가나 (browser-tool.js 영수증)',
    경로: ['src/runtime/browser-tool.js'],
    // 목록을 통째로 실어 보낸다면 영수증에 이런 칸이 있어야 한다. 없으면 **전달에서 잘린 것**이다.
    생성전용: ['actionable:', 'elements:', 'clickable:', '요소목록:'],
    // browser.js 는 목록을 모은다(actionable). 이 자가 보는 것은 **전달 자리**(browser-tool.js)다.
    양성대조: { 말: 'actionable', 자리: 'src/runtime/browser.js', 검색어로잡힌다: true,
      왜: '모으는 자리는 이 검색법에 걸린다 — 그러므로 전달 자리의 0건은 「안 만들었다」가 아니라 「모아 놓고 안 준다」다' },
    // 잘리는 자리를 함께 낸다 — "안 만들었다"가 아니라 "모아 놓고 걸러낸다"는 것이 사실이다.
    모호: ['canOpen', 'actionable'],
  },
  {
    subject: 'channel-inbox',
    질문: '받은 것을 **조회**하는 손이 있나 (계획서 ⑦: 와이어 28개 중 0)',
    경로: ['src/surface/demo-context.js', 'src/surface/live-context.js', 'src/runtime'],
    생성전용: ['makeChannelInbox', 'inboxTool', "id: 'telegram.inbox'", "id: 'slack.inbox'", "id: 'mail.inbox'", "id: 'telegram.send'"],
    // 진짜 부재다(와이어 28개 중 0). 그래서 **같은 모양의 있는 손**을 이 검색법이 잡는 것을 보인다 —
    // 보내는 손은 `id: 'telegram.send'` 로 선언돼 있고, 받는 손은 그 자리에 아예 없다.
    양성대조: { 말: "id: 'telegram.send'", 자리: 'src/surface/demo-context.js', 검색어로잡힌다: true,
      왜: '같은 선언 모양의 발신 손은 잡힌다 — 그러므로 수신 손 0건은 눈이 먼 것이 아니라 진짜 부재다' },
    모호: ['inbox', 'handleChannelMessage', 'receive'],
  },
]);

// ─────────────────────────────────────────────────────────────────────────────
// 1. 손 인벤토리 — descriptor 의 action enum 을 코드에서 뜬다.
// ─────────────────────────────────────────────────────────────────────────────
async function 손인벤토리() {
  const { demoDescriptors, demoTools } = await import(join(저장소, 'src/surface/demo-context.js'));
  // 화면 손 둘은 주입할 때만 선언이 딸려온다(demo-context §demoDescriptors) — 계측이므로 둘 다 켠다.
  const 선언 = demoDescriptors({ desktop: true, desktopAct: true });
  // 손(handler)이 실제로 붙는지는 따로 본다 — 선언은 있고 손은 없는 것이 있다(예: mail.send).
  const 기본손 = new Set(Object.keys(demoTools({}).tools ?? {}));
  const 모든손 = new Set(Object.keys(demoTools(전부주입()).tools ?? {}));
  return 선언.map((d) => {
    const enum값 = d.schema?.parameters?.properties?.action?.enum;
    return {
      id: d.id,
      label: d.label ?? null,
      verbs: Array.isArray(enum값) ? [...enum값] : null,
      verbCount: Array.isArray(enum값) ? enum값.length : null,
      verbSource: Array.isArray(enum값) ? 'schema.parameters.properties.action.enum' : 'enum 없음',
      handlerInDefaultRoom: 기본손.has(d.id),
      // **선언이 있다고 손이 있는 것이 아니다.** `demoTools` 에 이 손을 받을 자리가 있나만 본다 —
      // 그 자리에 실제 손이 붙는지는 이 컴퓨터 조건(브라우저 유무·화면 권한)의 몫이다.
      // `mail.send` 가 정확히 이 자리에서 갈린다: 선언은 있고 받을 자리가 **어디에도 없다.**
      handlerSlotExists: 모든손.has(d.id),
    };
  });
}

/** demoTools 가 받는 **모든** 선택 손 자리를 무해한 껍데기로 채운다(노출 상한 측정용). */
function 전부주입() {
  const 껍데기 = () => ({
    isFixture: true,
    async handler() { throw new Error('state-probe: 계측용 껍데기 — 절대 실행되지 않는다'); },
  });
  return {
    agentDelegate: 껍데기(), desktop: 껍데기(), desktopAct: 껍데기(),
    localTerminal: 껍데기(), localProcess: 껍데기(), capsule: 껍데기(),
    localLocate: 껍데기(), localDiscovery: 껍데기(), localSystem: 껍데기(),
    browserObserve: 껍데기(), browserAct: 껍데기(), sessionSearch: 껍데기(),
    senders: { 'slack.post': 껍데기(), 'telegram.send': 껍데기(), 'mail.send': 껍데기() },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. 모델 노출 도구 — **격리 임시 방에 서버를 실기동해** 한 턴을 넣고,
//    모델이 `options.tools` 로 실제로 받은 이름 전량을 캡처한다.
//    유료 모델 호출 0 — 응답만 돌려주는 가짜 모델을 쓴다.
// ─────────────────────────────────────────────────────────────────────────────
async function 모델노출도구() {
  const { makeServer } = await import(join(저장소, 'src/surface/server.js'));
  const { demoEnv, demoTools } = await import(join(저장소, 'src/surface/demo-context.js'));
  const { SessionStore } = await import(join(저장소, 'src/surface/session-store.js'));

  const 방 = await realpath(await mkdtemp(join(tmpdir(), 't5-state-probe-')));
  const 상태 = join(방, '.state');
  const 잡힌것 = [];
  // 가짜 모델 — **응답만 돌려준다.** 도구를 부르지 않으므로 어떤 손도 실행되지 않는다.
  const 가짜모델 = {
    async respond(_tc, opts = {}) {
      잡힌것.push((opts.tools ?? []).map((t) => t?.name ?? t?.function?.name ?? String(t)));
      return { text: '계측 중입니다.', toolCalls: [] };
    },
  };
  const 주입 = 전부주입();
  const server = makeServer({
    store: new SessionStore(상태),
    clock: () => 1_786_287_600_000, // 시계를 고정한다 — 시간은 학습의 근거가 아니다
    model: 가짜모델,
    // 브라우저 손 둘은 demo `FACTS` 표에 자리가 없어서 `connected:false` 로 떨어지고,
    // 그러면 `executable:false` 라 **모델 스키마에서 통째로 빠진다**(self-state.js §2축).
    // 라이브는 `live-context.js:245 factOverrides` 로 "이 컴퓨터에 브라우저가 있으면 연결됨"을
    // 넘긴다 — 계측기도 같은 것을 넘겨야 **노출 상한**을 재는 것이 된다. 안 넘기면 26 이 나오고
    // 계획서 §2 의 28 과 어긋나는데, 그 차이는 손이 없어서가 아니라 계측이 라이브와 달라서다.
    env: demoEnv({ ...주입, factOverrides: { 'browser.observe': { connected: true }, 'browser.act': { connected: true } } }),
    tools: demoTools(주입),
    // 오너 실사용 자리(~/.local/state/gpao-t5)를 절대 안 본다 — 전부 임시 방으로 돌린다.
    processEnv: { HOME: 방, GPAO_T5_HOME: 방, GPAO_T5_DATA_DIR: 상태, GPAO_T5_FILE_ROOTS: 방 },
  });
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((r) => r.json());
    await fetch(`${base}/turn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '지금 무엇을 할 수 있어?' }),
    }).then((r) => r.json());
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(방, { recursive: true, force: true });
  }
  // 한 턴 안에서 모델이 여러 번 불릴 수 있다(도구 없는 마무리 호출 포함) — **가장 큰 판**을 쓴다.
  const 최대 = 잡힌것.reduce((a, b) => (b.length > a.length ? b : a), []);
  return {
    capturedFrom: 'live-server-turn',
    isolation: '임시 방(mkdtemp) · processEnv 전량 임시 · 유료 모델 호출 0 · 손 실행 0',
    injection: '선언된 모든 손을 무해한 껍데기로 주입 — 이 값은 **노출 상한**이다',
    modelCalls: 잡힌것.length,
    perCall: 잡힌것.map((names) => names.length),
    count: 최대.length,
    names: 최대,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. 통제 채널 — model-control.js 의 채널 이름과 operation enum.
// ─────────────────────────────────────────────────────────────────────────────
async function 통제채널() {
  const { MODEL_CONTROL_SCHEMAS } = await import(join(저장소, 'src/kernel/l2-plan/model-control.js'));
  return MODEL_CONTROL_SCHEMAS.map((s) => {
    const enum값 = s.parameters?.properties?.operation?.enum;
    return {
      name: s.name,
      operations: Array.isArray(enum값) ? [...enum값] : null,
      operationSource: Array.isArray(enum값) ? 'parameters.properties.operation.enum' : 'enum 없음',
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. 부재 확인 — 실제로 파일을 훑는다. 훑은 파일 수까지 낸다.
// ─────────────────────────────────────────────────────────────────────────────
const 훑지않음 = new Set(['node_modules', '.git', '.claude', 'coverage', 'dist', 'build']);
const 글자파일 = /\.(mjs|js|cjs|ts|json|sh|py|swift|m|md)$/;
// **계측기는 자기 자신을 세지 않는다.** 첫 판에서 `document-create` 히트 17건이 전부
// 이 파일의 검색어 목록이었다 — 그대로 뒀으면 ⑧「빠진 것 없음」이라는 거짓 초록이 나갔다.
// 계측기가 스스로를 재는 자리는 계측기 자신이 가장 먼저 막는다.
const 자기파일 = new Set(['scripts/state-probe.mjs', 'test/state-probe.test.js']);

async function 파일훑기(상대경로) {
  const 절대 = join(저장소, 상대경로);
  let 정보;
  try { 정보 = await stat(절대); } catch { return []; }
  if (정보.isFile()) return [상대경로];
  const 모음 = [];
  const 항목들 = await readdir(절대, { withFileTypes: true });
  for (const 항목 of 항목들) {
    if (훑지않음.has(항목.name)) continue;
    const 다음 = join(상대경로, 항목.name);
    if (항목.isDirectory()) 모음.push(...await 파일훑기(다음));
    else if (글자파일.test(항목.name)) 모음.push(다음);
  }
  return 모음;
}

async function 부재확인() {
  const 결과 = [];
  for (const 규격 of 부재규격) {
    const 파일들 = (await Promise.all(규격.경로.map((p) => 파일훑기(p)))).flat();
    const 유일 = [...new Set(파일들)].filter((p) => !자기파일.has(p));
    const found = [];
    const ambiguous = [];
    for (const 상대 of 유일) {
      let 본문;
      try { 본문 = await readFile(join(저장소, 상대), 'utf8'); } catch { continue; }
      const 줄들 = 본문.split('\n');
      for (let i = 0; i < 줄들.length; i += 1) {
        for (const 말 of 규격.생성전용) {
          if (줄들[i].includes(말)) found.push({ term: 말, at: `${상대}:${i + 1}` });
        }
        for (const 말 of 규격.모호) {
          if (줄들[i].includes(말)) ambiguous.push({ term: 말, at: `${상대}:${i + 1}` });
        }
      }
    }
    // ── **양성 대조를 먼저 돌린다**(F-104). 이 자가 실재하는 것을 잡는지 스스로 증명한다.
    // 대조가 안 걸리면 이 줄은 「없다」가 아니라 **「이 자로는 못 본다」**로 나간다.
    let 대조섰나 = null;
    if (규격.양성대조) {
      const 원문 = await readFile(join(저장소, 규격.양성대조.자리), 'utf8').catch(() => null);
      대조섰나 = 원문 !== null && 원문.includes(규격.양성대조.말);
    }
    결과.push({
      subject: 규격.subject,
      question: 규격.질문,
      control: 규격.양성대조 ? { ...규격.양성대조, 섰나: 대조섰나 } : null,
      // **부재를 선언할 자격** — 대조가 안 섰으면 0건을 부재로 읽지 않는다.
      canClaimAbsence: 대조섰나 === true,
      searchedTerms: [...규격.생성전용],
      ambiguousTerms: [...규격.모호],
      searchedPaths: [...규격.경로],
      filesScanned: 유일.length,
      selfExcluded: [...자기파일],
      found,
      foundCount: found.length,
      // 모호 히트는 **부재의 반증이 아니다** — 사람이 file:line 을 직접 보라고 낸다.
      ambiguousCount: ambiguous.length,
      ambiguous: ambiguous.slice(0, 40),
      ambiguousTruncated: ambiguous.length > 40,
    });
  }
  return 결과;
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. 코드에서 바로 파생되는 사실들 — 어느 값도 여기 적혀 있지 않다. 전부 읽어서 센다.
// ─────────────────────────────────────────────────────────────────────────────

/** 문서 **읽기** 형식 — document-intake.js 의 FORMATS 표를 읽고, 그 함수로 되짚어 확인한다. */
async function 문서읽기형식() {
  const 소스 = await readFile(join(저장소, 'src/runtime/document-intake.js'), 'utf8');
  const 표 = 소스.match(/const FORMATS = new Map\(\[([\s\S]*?)\]\);/);
  const 쌍 = [...(표?.[1] ?? '').matchAll(/\['(\.[a-z0-9]+)',\s*'([a-z0-9]+)'\]/gi)]
    .map((m) => ({ ext: m[1], tag: m[2] }));
  const { documentFormat } = await import(join(저장소, 'src/runtime/document-intake.js'));
  // 표에서 읽은 것을 **함수로 되짚는다** — 표만 보면 죽은 줄을 살아 있다고 셀 수 있다.
  const 확인됨 = 쌍.filter(({ ext, tag }) => documentFormat(`계측${ext}`) === tag);
  // 계열: 한 태그가 다른 태그의 접두면 같은 계열로 접는다(hwp ⊂ hwpx).
  const 태그들 = [...new Set(확인됨.map((p) => p.tag))];
  const 계열 = 태그들.filter((t) => !태그들.some((o) => o !== t && t.startsWith(o)));
  return {
    source: 'src/runtime/document-intake.js FORMATS + documentFormat() 되짚기',
    extensions: 확인됨.map((p) => p.ext),
    tags: 태그들,
    families: 계열,
    familyCount: 계열.length,
  };
}

/** 브라우저 손이 실제로 쓰는 CDP 도메인 — `conn.send('X.Y')` 를 세어서 낸다. */
async function 브라우저CDP() {
  const 상대 = 'src/runtime/browser.js';
  const 소스 = await readFile(join(저장소, 상대), 'utf8');
  const 부름 = [...소스.matchAll(/send\(\s*'([A-Z][A-Za-z]*)\.([A-Za-z]+)'/g)]
    .map((m) => ({ domain: m[1], method: `${m[1]}.${m[2]}` }));
  const 도메인 = [...new Set(부름.map((c) => c.domain))].sort();
  const 메서드 = [...new Set(부름.map((c) => c.method))].sort();
  // 입력 도메인이 없다는 주장 — 무엇을 찾았는지 함께 낸다(F-56).
  const 입력검색어 = ['Input.dispatchKeyEvent', 'Input.dispatchMouseEvent', 'Input.insertText', "'Input."];
  const 입력히트 = 입력검색어.filter((t) => 소스.includes(t));
  return {
    source: 상대,
    domains: 도메인,
    methods: 메서드,
    inputSearchedTerms: 입력검색어,
    inputHits: 입력히트,
    hasInputDomain: 입력히트.length > 0,
  };
}

/** 모델 창 예산 표 — model-window.js 의 `창표` 를 그대로 센다. */
async function 창예산표() {
  const { 창표 } = await import(join(저장소, 'src/kernel/l1-intent/model-window.js'));
  return {
    source: 'src/kernel/l1-intent/model-window.js 창표',
    models: Object.keys(창표),
    count: Object.keys(창표).length,
  };
}

/** l5-growth 고아 — `src/` 안에서 아무도 안 부르는 파일. 검사(`test/`)는 소비자로 안 센다. */
async function 성장고아() {
  const 성장파일 = (await readdir(join(저장소, 'src/kernel/l5-growth')))
    .filter((f) => f.endsWith('.js'));
  const 전체 = await 파일훑기('src');
  const 본문 = new Map();
  for (const 상대 of 전체) {
    try { 본문.set(상대, await readFile(join(저장소, 상대), 'utf8')); } catch { /* 못 읽으면 안 센다 */ }
  }
  const 고아 = [];
  const 소비자수 = {};
  for (const 파일 of 성장파일) {
    const 나 = `src/kernel/l5-growth/${파일}`;
    let n = 0;
    for (const [상대, 글] of 본문) {
      if (상대 === 나) continue;
      if (glob부르기(글, 파일)) n += 1;
    }
    소비자수[파일] = n;
    if (n === 0) 고아.push(파일);
  }
  return {
    source: 'src/kernel/l5-growth/*.js 를 src/ 전역에서 import 로 되짚음 (test/ 는 소비자로 안 셈)',
    files: 성장파일.length,
    consumers: 소비자수,
    orphans: 고아,
    orphanCount: 고아.length,
  };
}

/** `import ... from '…/<파일>'` 형태로 부르는지. 확장자 유무·경로 깊이를 안 가린다. */
function glob부르기(글, 파일) {
  const 이름 = 파일.replace(/\.js$/, '');
  return new RegExp(`from\\s+'[^']*l5-growth/${이름}\\.js'`).test(글)
    || new RegExp(`from\\s+'\\.[^']*/${이름}\\.js'`).test(글) && 글.includes('l5-growth');
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. 미측정(유료 필요) — **값을 지어내지 않는다.** 계획서 §2 에 적힌 마지막 측정값을
//    파일에서 **그대로 인용**하고, 다시 얻으려면 무엇을 돌리는지 한 줄로 낸다.
//    이러면 §2 가 조용히 낡지 않는다 — 낡은 줄이 스스로 "나는 낡았을 수 있다"고 말한다.
// ─────────────────────────────────────────────────────────────────────────────
const 유료필요 = Object.freeze([
  { 항목: '모델이 자기 손을 아는가 (능력 진술)', 계획서키: '능력 진술',
    재측정: 'npm start 로 실모델 붙여 "웹 검색창에 글자 칠 수 있어?" 5회 (성질 1 · 유료)' },
  { 항목: '자력 완결 (사용자 손 0회)', 계획서키: '자력 완결',
    재측정: 'npm start 로 실모델 붙여 "네이버 열어서 전세사기 검색 결과 알려줘" 3회 (칸 4 · 유료+실기기)' },
  { 항목: '자기보고 거짓 (전·후 대조)', 계획서키: '자기보고 거짓',
    재측정: 'npm start 로 실모델 붙여 창 전환 과업 (성질 2 · 유료+실기기)' },
  { 항목: '실제 능력 (실크롬 승인 카드까지)', 계획서키: '실제 능력',
    재측정: 'node scripts/verify-pc-hands-live.mjs (유료+실기기)' },
  { 항목: '회귀 건수', 계획서키: '회귀',
    재측정: 'npm test — 계측기는 검사를 대신 돌리지 않는다(무한 재귀)' },
  { 항목: '시스템 프롬프트 글자 수', 계획서키: '와이어 도구',
    재측정: 'GPAO_T5_PROMPT_DUMP=<자리> 로 실모델 한 턴 뒤 systemChars (상황 파생 · 한 값이 대표값 아님)' },
  { 항목: '커넥터 실동작', 계획서키: null,
    재측정: '한 항목을 끝까지 걸어보고 기록 (계획서 §11 그대로 미측정 · 칸 10)' },
]);

/** 계획서 §2 블록을 그대로 떠서 인용한다. 값을 계측기가 알지 못하게 — 파일이 진실이다. */
async function 계획서인용() {
  let 원문 = '';
  try { 원문 = await readFile(join(저장소, 계획서), 'utf8'); }
  catch { return { available: false, reason: `${계획서} 를 못 읽었다`, items: [] }; }
  const 절 = 원문.split(/\n## /).find((s) => s.startsWith('2. 지금 상태'));
  const 블록 = 절?.match(/```\n([\s\S]*?)```/)?.[1] ?? '';
  const 줄들 = 블록.split('\n').filter((l) => l.trim());
  const 찾기 = (키) => 줄들.find((l) => l.trimStart().startsWith(키)) ?? null;
  return {
    available: Boolean(블록),
    citedFrom: `${계획서} §2 (코드 블록 원문)`,
    items: 유료필요.map((u) => {
      const 줄 = u.계획서키 ? 찾기(u.계획서키) : null;
      return {
        항목: u.항목,
        상태: '미측정(유료 필요)',
        최종측정값: 줄 ? 줄.trim() : '(§2 에 해당 줄 없음 — 인용할 값이 없다)',
        출처: u.계획서키 ? `${계획서} §2` : '(없음)',
        재측정명령: u.재측정,
      };
    }),
    planSection2Lines: 줄들.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. 체감 지표 — **이미 저장된 회차 기록에서 사후 집계만** 한다.
//     새로 돌리지 않는다(유료 0 · 실기기 0). 원장에 상시로 찍는 일은 다른 칸이다.
//
// 규율 둘(PM 2026-08-11):
//   · **비율을 내지 않는다.** "과업 턴인가 순수 문답인가"는 사람 판정이고, 계측기가
//     흉내내는 순간 자[尺]가 오염된다. 건수와 목록만 낸다.
//   · **못 잰 것을 0 으로 적지 않는다.** 값 대신 「계측 불가 · 사유」를 적는다 —
//     아무것도 안 재 놓고 초록불이 켜져 있던 것이 우리가 당한 병이다.
// ─────────────────────────────────────────────────────────────────────────────
const 회차기록뿌리 = 'docs/03-verification/evidence';
const 제안칸 = ['skillProposal', 'automationProposal', 'agentProposal', 'memorySuggestion',
  'memoryCorrection', 'memoryWithdrawal', 'toolCandidate'];

/** 회차 기록 파일 하나에서 T5 턴 배열을 꺼낸다. 모양이 아니면 null — 억지로 읽지 않는다. */
function 턴배열(값) {
  const 턴들 = 값?.턴들;
  if (!Array.isArray(턴들) || !턴들.length) return null;
  return 턴들.every((t) => t && typeof t === 'object' && typeof t.kind === 'string') ? 턴들 : null;
}

async function 체감지표({ recordsDir, exposedNames }) {
  const 파일들 = (await 파일훑기(recordsDir)).filter((p) => p.endsWith('.json'));
  const 과업 = [];
  let askUser글자히트 = 0;
  const 묶음이름 = (p) => (p.startsWith(`${recordsDir}/`) ? p.slice(recordsDir.length + 1).split('/')[0] : p);
  const 본묶음 = new Set();
  const 잡힌묶음 = new Set();
  for (const 상대 of 파일들) {
    본묶음.add(묶음이름(상대));
    let 글;
    try { 글 = await readFile(join(저장소, 상대), 'utf8'); } catch { continue; }
    if (글.includes('ask.user')) askUser글자히트 += 1;
    let 값;
    try { 값 = JSON.parse(글); } catch { continue; }
    const 턴들 = 턴배열(값);
    if (턴들) { 과업.push({ file: 상대, turns: 턴들 }); 잡힌묶음.add(묶음이름(상대)); }
  }
  // **집계에서 빠진 묶음을 숨기지 않는다.** 빠진 이유는 "결과가 0" 이 아니라
  // **T5 턴 모양(턴들[].kind)이 아니어서**다 — 다른 제품의 회차이거나 다른 하네스의 기록이다.
  const skippedSets = [...본묶음].filter((s) => !잡힌묶음.has(s)).sort();

  const 승인대기 = [];
  const 결과없이닫힘 = [];
  const 걸음들 = [];
  let 원장없는턴 = 0;
  let 걸음없는턴 = 0;
  let 전체턴 = 0;

  for (const { file, turns } of 과업) {
    for (let i = 0; i < turns.length; i += 1) {
      const t = turns[i];
      전체턴 += 1;
      if (t.kind === 'approval') 승인대기.push(`${file}#${i}`);

      // ② 걸음 수 — 모델이 손을 이어 쓴 걸음(turnExchange). 없는 기록은 **안 센다.**
      if (Array.isArray(t.turnExchange)) 걸음들.push(t.turnExchange.length);
      else 걸음없는턴 += 1;

      // ④ 「결과 없이 닫힌 턴」 — 문구를 안 읽는다. 아무 일도 안 일어났는지만 본다.
      //    도구 호출 0 · 통제 제안 0 · 원장 영수증 0 · 승인 카드 아님.
      const l = t.ledger;
      if (!l || typeof l !== 'object') { 원장없는턴 += 1; continue; }
      const 영수증 = (l.confirmed?.length ?? 0) + (l.unconfirmed?.length ?? 0) + (l.estimated?.length ?? 0);
      const 걸음 = Array.isArray(t.turnExchange) ? t.turnExchange.length : 0;
      const 제안 = 제안칸.some((k) => t[k]);
      if (t.kind !== 'approval' && 영수증 === 0 && 걸음 === 0 && !제안) {
        결과없이닫힘.push(`${file}#${i}`);
      }
    }
  }

  const 중앙값 = (xs) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  // **묶음별로도 낸다.** 전체 합계는 회차 묶음이 섞인 값이라 어느 시험의 수인지 알 수 없다 —
  // 감사가 특정 회차(예: 오늘 19세션)를 짚으려면 그 묶음의 수가 따로 있어야 한다.
  const 묶음 = new Map();
  for (const { file, turns } of 과업) {
    const 이름 = file.startsWith(`${recordsDir}/`)
      ? file.slice(recordsDir.length + 1).split('/')[0] : file;
    const b = 묶음.get(이름) ?? { set: 이름, files: 0, turns: 0, 승인대기: 0, 결과없이닫힘: 0, 걸음: [] };
    b.files += 1;
    for (const t of turns) {
      b.turns += 1;
      if (t.kind === 'approval') b.승인대기 += 1;
      if (Array.isArray(t.turnExchange)) b.걸음.push(t.turnExchange.length);
      const l = t.ledger;
      if (!l || typeof l !== 'object') continue;
      const 영수증 = (l.confirmed?.length ?? 0) + (l.unconfirmed?.length ?? 0) + (l.estimated?.length ?? 0);
      const 걸음 = Array.isArray(t.turnExchange) ? t.turnExchange.length : 0;
      if (t.kind !== 'approval' && 영수증 === 0 && 걸음 === 0 && !제안칸.some((k) => t[k])) b.결과없이닫힘 += 1;
    }
    묶음.set(이름, b);
  }
  const byRecordSet = [...묶음.values()].map((b) => ({
    set: b.set, files: b.files, turns: b.turns,
    승인대기: b.승인대기, 결과없이닫힘: b.결과없이닫힘,
    최대걸음: b.걸음.length ? Math.max(...b.걸음) : null,
    중앙걸음: 중앙값(b.걸음),
    걸음기록없음: b.turns - b.걸음.length,
  })).sort((a, b) => a.set.localeCompare(b.set));

  return {
    byRecordSet,
    skippedSets,
    skippedNote: 'T5 턴 모양(턴들[].kind)이 아니라 집계에서 빠진 묶음이다 — 결과가 0 이라는 뜻이 아니다.'
      + ' 다른 회차 묶음을 재려면 `--records <자리>` 로 그 자리를 준다.',
    source: `${recordsDir} 아래 이미 저장된 회차 기록에서 **사후 집계** (새로 돌리지 않는다)`,
    filesScanned: 파일들.length,
    recordFiles: 과업.length,
    turnsScanned: 전체턴,
    // 비율은 내지 않는다 — 분모(과업 턴인가 문답인가)는 사람 판정이다.
    비율: '내지 않는다 — 과업/문답 구분은 감사가 눈으로 한다(분모가 동결된 7과목 재시험이 비율의 자리)',

    승인대기: { count: 승인대기.length, turns: 승인대기.slice(0, 40), truncated: 승인대기.length > 40 },

    걸음수: 걸음들.length
      ? { measurableTurns: 걸음들.length, max: Math.max(...걸음들), median: 중앙값(걸음들),
        기록없는턴: 걸음없는턴 }
      : { 계측불가: true,
        사유: `회차 기록 ${전체턴}턴 중 turnExchange 를 담은 턴이 0 이다 — 걸음 수를 셀 재료가 없다`,
        기록없는턴: 걸음없는턴 },

    // ③ 거짓 건수 — **계측 불가.** 0 으로 적지 않는다.
    거짓건수: { 계측불가: true,
      사유: '두 재료가 회차 기록에 없다 — ① 손의 전·후 값(desktop.*·browser.* 의 전/후 대조)이'
        + ' 저장돼 있지 않고, ② "완료를 주장했나"는 답변 본문 판정이라 본문 정규식으로 세면'
        + ' 오늘 감사가 당한 오판(문구 수로 실제 성공 3건을 실패로 판정)을 그대로 반복한다.'
        + ' 재는 자리는 원장에 전·후를 상시로 찍는 칸(성질 2 · 칸 3)이지 계측기가 아니다.' },

    결과없이닫힌턴: { count: 결과없이닫힘.length, turns: 결과없이닫힘.slice(0, 40),
      truncated: 결과없이닫힘.length > 40,
      정의: '도구 호출 0 · 통제 제안 0 · 원장 영수증 0 · 승인 카드 아님 — 문구는 안 읽는다',
      판정불가턴: 원장없는턴,
      주의: 원장없는턴 ? `원장(ledger) 칸이 없는 턴 ${원장없는턴}개는 세지 않았다 — 0 으로 접지 않는다` : null },

    askUser: {
      exposedToModel: exposedNames.includes('ask.user'),
      availableViaSelector: exposedNames.includes('control.select'),
      channelAt: 'src/kernel/l2-plan/model-control.js (MODEL_CONTROL_SCHEMAS)',
      usageCount: { 계측불가: true,
        사유: '통제 호출은 splitModelControlCalls 가 turnExchange 밖에서 갈라내므로'
          + ' 회차 기록의 손 목록에 안 실린다 — 「몇 번 썼나」를 셀 칸이 기록에 없다' },
      글자히트파일수: askUser글자히트,
      글자히트주의: '위 수는 파일에 그 글자가 있었다는 것뿐이다 — 사용 횟수가 아니다(F-56)',
    },
  };
}

/** package.json 의 의존성 — 문서 생성 부품 부재의 두 번째 근거. */
async function 의존성() {
  const pkg = JSON.parse(await readFile(join(저장소, 'package.json'), 'utf8'));
  return {
    dependencies: Object.keys(pkg.dependencies ?? {}),
    devDependencies: Object.keys(pkg.devDependencies ?? {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. 기관별 결손 표 — 1~3·5 를 §4 기관 열에 매핑한다.
// ─────────────────────────────────────────────────────────────────────────────
function 기관결손({ hands, channels, absence }) {
  const 손표 = new Map(hands.map((h) => [h.id, h]));
  const 채널표 = new Map(channels.map((c) => [c.name, c]));
  const 부재표 = new Map(absence.map((a) => [a.subject, a]));

  // **선언만으로 「있다」고 적지 않는다.** 손이 붙을 자리까지 있어야 있는 것이다 —
  // `mail.send` 는 선언은 있고 받을 자리가 어디에도 없다. 예전에 바로 그 유령을
  // "연결됨"으로 모델과 사용자에게 말한 적이 있다(self-state.js:73).
  const 손확인 = (토큰) => {
    const [id, verb] = 토큰.split(':');
    const 손 = 손표.get(id);
    if (!손 || !손.handlerSlotExists) return false;
    if (!verb) return true;
    return Array.isArray(손.verbs) && 손.verbs.includes(verb);
  };
  const 채널확인 = (토큰) => {
    const [name, op] = 토큰.split(':');
    const 채널 = 채널표.get(name);
    if (!채널) return false;
    if (!op) return true;
    return Array.isArray(채널.operations) && 채널.operations.includes(op);
  };
  const 부품확인 = (key) => (부재표.get(key)?.foundCount ?? 0) > 0;

  return 기관규격.map((기관) => {
    const have = [];
    const missing = [];
    const required = [];
    for (const 항목 of 기관.요구) {
      const 토큰들 = [
        ...(항목.손 ?? []).map((t) => ({ kind: '손', t })),
        ...(항목.채널 ?? []).map((t) => ({ kind: '채널', t })),
        ...(항목.부품 ? [{ kind: '부품', t: 항목.부품 }] : []),
      ];
      required.push(`${항목.요구}[${토큰들.map((x) => x.t).join('|')}]`);
      const 선 = 토큰들.find(({ kind, t }) => (kind === '손' ? 손확인(t)
        : kind === '채널' ? 채널확인(t) : 부품확인(t)));
      if (선) have.push(`${항목.요구}=${선.t}`);
      else missing.push(`${항목.요구}[${토큰들.map((x) => x.t).join('|')} 없음]`);
    }
    return {
      key: 기관.key, 번호: 기관.번호, name: 기관.name,
      상한: 기관.상한, 계획서층: 기관.계획서층,
      requiredSource: `${계획서} §4 ${기관.번호} 「상한」`,
      required, have, missing,
      ...(기관.모호 ? { 모호: 기관.모호 } : {}),
      ...(기관.주의 ? { 주의: 기관.주의 } : {}),
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. 확정 계열 — **대본 모델 관통**(PM 정정 1). 서버·저장소·권한 판정·프롬프트 조립은
//    전부 진짜로 돌리고 **모델 판단만 대본**이다. 유료 호출 0 · 실기기 접촉 0.
//
//    재는 것: 계열마다 제안이 실제로 저장까지 가나. "말과 저장이 어긋난다"(성질 3)를
//    문장이 아니라 **저장소 건수**로 잰다.
// ─────────────────────────────────────────────────────────────────────────────
const 계열규격 = Object.freeze([
  { key: 'skill', name: '스킬', 채널: 'skill.propose', 발화: '앞으로 매번 이렇게 정산 확인해줘',
    확정칸: 'skills' },
  { key: 'agent', name: '에이전트', 채널: 'agent.propose', 발화: '리서치 담당 역할을 하나 등록해줘',
    확정칸: 'profiles' },
  { key: 'memory', name: '기억', 채널: 'memory.propose', 발화: '나 커피 마셔',
    후보칸: 'candidates', 확정칸: 'promoted' },
  { key: 'automation', name: '자동화', 채널: 'automation.propose + automation.control:commit',
    발화: '매일 아침 9시에 정산 확인해줘', 후보칸: 'candidates', 확정칸: 'jobs' },
]);

async function 확정계열({ 방, 상태 }) {
  const { makeServer } = await import(join(저장소, 'src/surface/server.js'));
  const { demoEnv, demoTools } = await import(join(저장소, 'src/surface/demo-context.js'));
  const { SessionStore } = await import(join(저장소, 'src/surface/session-store.js'));
  const { AutomationJobStore } = await import(join(저장소, 'src/surface/automation-store.js'));
  const { SkillDefinitionStore } = await import(join(저장소, 'src/surface/skill-store.js'));
  const { AgentProfileStore } = await import(join(저장소, 'src/surface/agent-profile-store.js'));
  const { MemoryStore } = await import(join(저장소, 'src/surface/memory-store.js'));
  const { AUTOMATION_SCHEMA_VERSION, contentHash, skillHashSource } =
    await import(join(저장소, 'src/kernel/l5-growth/automation-contracts.js'));
  // **활성 게이트는 제품에서 빌린다.** 계측기가 제 손으로 상태 문자열을 판정하면
  // 제품이 게이트를 바꾼 날 계측기만 옛말을 하게 된다 — 문서가 낡는 것과 같은 병이다.
  const { canInfluence } = await import(join(저장소, 'src/kernel/l5-growth/skill-learning.js'));
  const { canStartAgentRun } = await import(join(저장소, 'src/kernel/l5-growth/agent-profile.js'));
  const { isInfluenceEligible } = await import(join(저장소, 'src/kernel/l1-intent/context-mesh.js'));
  const { projectAutomations } = await import(join(저장소, 'src/surface/automation-surface.js'));
  const 활성게이트 = {
    // 스킬: 대화에 영향을 줄 자격 — admitted + 확인 + replay 통과(스키마 2 는 state==='active')
    skill: { 이름: 'canInfluence()', 세기: (a) => a.filter((e) => canInfluence(e)).length },
    // 담당: 실행을 시작할 자격 — 활성 + 경계 유효
    agent: { 이름: 'canStartAgentRun()', 세기: (a) => a.filter((e) => canStartAgentRun(e)).length },
    // 기억: 다음 턴 재료로 실릴 자격
    memory: { 이름: 'isInfluenceEligible()', 세기: (a) => a.filter((e) => isInfluenceEligible(e)).length },
    // 자동화: 화면에 살아 있는 예약으로 서는 것(목록 단위 판정이라 항목별이 아니다)
    automation: { 이름: 'projectAutomations().active', 세기: (a) => projectAutomations(a).active.length },
  };

  const NOW = 1_786_287_600_000;
  const 저장 = {
    session: new SessionStore(상태),
    automation: new AutomationJobStore(상태),
    skill: new SkillDefinitionStore(상태),
    agent: new AgentProfileStore(상태),
    memory: new MemoryStore(상태),
  };

  // **씨앗을 밝힌다**(정직 부기): `automation.control commit` 은 **활성 스킬과 활성 담당**이
  // 있어야 붙는다(server.js:793-794). 없으면 `binding_not_active` 로 떨어지는데, 그건
  // 자동화 계열이 안 서 있다는 뜻이 아니라 **재는 방이 비었다**는 뜻이다.
  // 그래서 동결 시험(`test/f64-l6-automation-truth-red.test.js`)과 같은 모양으로 씨앗을 둔다.
  const 씨앗스킬 = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION, id: 'probe-skill', name: '계측용 확인',
    purpose: '로컬 자료를 정해진 때 확인한다', version: 1, contentHash: '', inputs: [],
    steps: [{ kind: 'read', instruction: '로컬 자료를 확인한다' }],
    resultContract: { kind: 'summary' }, requiredCapabilities: ['local.file'],
    authorityHints: ['read'], replayCases: [],
    source: { kind: 'state-probe', sessionId: null, traceIds: [] }, state: 'active',
    createdAt: 1, updatedAt: 1, previousVersion: null,
  };
  씨앗스킬.contentHash = contentHash(skillHashSource(씨앗스킬));
  await 저장.skill.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, skills: [씨앗스킬] });
  await 저장.agent.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, profiles: [{
    schemaVersion: AUTOMATION_SCHEMA_VERSION, id: 'probe-agent', name: '계측용 담당',
    purpose: '허용된 로컬 자료를 확인한다', modelRole: 'worker', toolAllowlist: ['local.file'],
    workspaceScope: [방], defaultBudgets: { maxToolCalls: 4, timeoutMs: 30_000, maxCost: 1, maxConcurrency: 1 },
    authorityCeiling: 'A1', state: 'active', createdAt: 1, updatedAt: 1,
  }] });
  const 씨앗 = { skills: 1, profiles: 1 };

  const 대본 = { 낼것: () => ({ text: '네.', toolCalls: [] }), 범주: null };
  const 프롬프트판 = [];
  const { buildModelMessages } = await import(join(저장소, 'src/runtime/model-provider.js'));
  const 가짜모델 = {
    async respond(tc, opts = {}) {
      // **캐시 접두 계측을 같은 관통에서 뜬다** — 프롬프트 조립은 진짜다(모델 판단만 대본).
      try {
        const m = buildModelMessages(tc);
        프롬프트판.push({ systemStable: m.systemStable ?? null, tools: opts.tools ?? [] });
      } catch { /* 조립이 안 되면 그 판은 안 센다 — 지어내지 않는다 */ }
      if ((opts.tools ?? []).some((tool) => tool.name === 'control.select') && 대본.범주) {
        return { text: '', toolCalls: [{ name: 'control.select', args: { categories: [대본.범주] } }] };
      }
      return 대본.낼것(tc, opts);
    },
  };

  const server = makeServer({
    store: 저장.session, automationStore: 저장.automation, skillStore: 저장.skill,
    agentProfileStore: 저장.agent, memoryStore: 저장.memory,
    clock: () => NOW, model: 가짜모델, env: demoEnv(), tools: demoTools({}),
    processEnv: { HOME: 방, GPAO_T5_HOME: 방, GPAO_T5_DATA_DIR: 상태, GPAO_T5_FILE_ROOTS: 방 },
  });

  const 결과 = [];
  try {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((r) => r.json());
    const turn = (text) => fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text }),
    }).then((r) => r.json());

    const 인자 = {
      'skill.propose': {
        name: '계측용 확인', purpose: '지난주 정산을 확인한다', steps: ['로컬 자료를 읽는다'],
        resultContract: { kind: 'summary' }, requiredCapabilities: ['local.file'],
        replayCases: [{ id: 'p1', kind: 'positive', inputFacts: ['a'], expectedFacts: ['b'], forbiddenFacts: [] }],
      },
      'agent.propose': {
        name: '계측용 분석 담당', purpose: '허용된 자리만 본다', modelRole: 'worker',
        toolAllowlist: ['local.file'], workspaceScope: [방], authorityCeiling: 'A1',
      },
      'memory.propose': {
        statement: '사용자는 커피를 마신다', kind: 'user_fact', evidence: ['사용자가 그렇게 말했다'],
      },
      'automation.propose': {
        statement: '매일 아침 9시에 정산 확인', kind: 'daily', operation: 'create',
        trigger: { kind: 'daily', timezone: 'Asia/Seoul', localTime: '09:00', misfirePolicy: 'skip' },
        tool: 'local.file', action: { args: { action: 'read', path: '정산.txt' } },
        skillPurpose: '정산 확인', deliveryIntent: 'none',
      },
    };

    for (const 계열 of 계열규격) {
      const 채널이름 = 계열.key === 'automation' ? 'automation.propose' : 계열.채널;
      대본.범주 = 계열.key === 'skill' ? 'skill'
        : 계열.key === 'agent' ? 'agent'
          : 계열.key === 'memory' ? 'memory' : 'automation';
      대본.낼것 = (_tc, opts) => (opts.tools?.length
        ? { text: '', toolCalls: [{ name: 채널이름, args: 인자[채널이름] }] }
        : { text: '적어 뒀어요.', toolCalls: [] });
      await turn(계열.발화);
      let 확정거절 = null;
      if (계열.key === 'automation') {
        // 후보를 본 그 자리에서 확정한다 — 스냅샷이 준 ref·revision 을 그대로 되돌려 준다.
        대본.낼것 = (tc, opts) => {
          const c = tc.automationReality?.candidates?.items?.[0];
          if (!opts.tools?.length || !c) return { text: '켰어요.', toolCalls: [] };
          return { text: '', toolCalls: [{ name: 'automation.control', args: {
            operation: 'commit', targetCandidateRef: c.candidateRef, targetCandidateRevision: c.revision,
          } }] };
        };
        const t = await turn('그거 켜줘');
        if (t?.automationControl?.rejected) 확정거절 = t.automationControl.reason ?? '이유 없음';
      }
      const 사진 = await 저장[계열.key].load();
      const 후보수 = 계열.후보칸 ? (사진[계열.후보칸]?.length ?? 0) : null;
      const 원래확정 = 계열.key === 'skill' ? 씨앗.skills : 계열.key === 'agent' ? 씨앗.profiles : 0;
      const 담긴것 = 사진[계열.확정칸] ?? [];
      const 저장수 = Math.max(0, 담긴것.length - 원래확정);
      // **「저장됐다」와 「선다」는 다른 문장이다**(2026-08-11 · 오너 지시로 수리).
      // 앞서는 배열 길이를 확정칸에 적었고, 그래서 `state:'proposed'` 로 앉은 스킬·담당이
      // ✅ 로 나갔다. 같은 표 안에서 자동화가 `binding_not_active` 로 떨어지는데도 ✅ 였다 —
      // 계측기가 자기 표에서 모순을 냈다. 판별은 **제품이 실제로 쓰는 게이트 그대로** 쓴다
      // (위 import 넷). 여기에 상태 문자열을 적어 넣지 않는다 — 적는 순간 제품이 게이트를
      // 바꿔도 계측기가 안 따라오고, 그게 문서가 낡는 것과 똑같은 병이다(판정 기준 ①).
      const 활성수 = Math.max(0, 활성게이트[계열.key].세기(담긴것) - 원래확정);
      결과.push({
        key: 계열.key, name: 계열.name, channel: 계열.채널, utterance: 계열.발화,
        candidateField: 계열.후보칸 ?? null, candidates: 후보수,
        settledField: 계열.확정칸, stored: 저장수, settled: 활성수,
        gate: 활성게이트[계열.key].이름, seeded: 원래확정,
        settles: 활성수 > 0,
        ...(확정거절 ? { rejectedReason: 확정거절 } : {}),
      });
    }
  } finally {
    await new Promise((r) => server.close(r));
  }
  return { 계열: 결과, 프롬프트판 };
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. 캐시 접두 안정성 — **감사 비용이 아니라 제품 원가**(PM 정정 3).
//    안정 접두가 호출마다 출렁이면 도구 스키마가 매 호출 전액 청구된다.
//    지문 계산은 `src/runtime/prompt-dump.js` 와 **같은 식**이다(sha256 앞 12자).
// ─────────────────────────────────────────────────────────────────────────────
async function 접두안정성(프롬프트판) {
  const { createHash } = await import('node:crypto');
  const 지문 = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 12);
  const 판 = 프롬프트판.filter((p) => typeof p.systemStable === 'string');
  const 안정지문 = 판.map((p) => 지문(p.systemStable));
  const 크기 = 판.map((p) => p.systemStable.length);
  const 도구지문 = 프롬프트판.map((p) => 지문(JSON.stringify(p.tools)));
  return {
    source: 'buildModelMessages(tc).systemStable · prompt-dump.js 와 같은 sha256 앞 12자',
    calls: 프롬프트판.length,
    stableCaptured: 판.length,
    systemStableShaKinds: new Set(안정지문).size,
    systemStableShas: [...new Set(안정지문)],
    systemStableCharsMin: 크기.length ? Math.min(...크기) : null,
    systemStableCharsMax: 크기.length ? Math.max(...크기) : null,
    toolListShaKinds: new Set(도구지문).size,
    읽는법: '안정 접두 지문 종류가 1 이면 캐시 접두가 산다. 여럿이면 그만큼 다시 청구된다.',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 표 그리기
// ─────────────────────────────────────────────────────────────────────────────
const 폭 = (s) => [...String(s)].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);
const 채움 = (s, n) => String(s) + ' '.repeat(Math.max(0, n - 폭(s)));

function 표(제목, 머리, 줄들) {
  if (!줄들.length) return `\n## ${제목}\n(없음)\n`;
  const 열폭 = 머리.map((h, i) => Math.max(폭(h), ...줄들.map((r) => 폭(r[i] ?? ''))));
  const 선 = (ch) =>열폭.map((w) => ch.repeat(w + 2)).join('+');
  const 행 = (r) => '|' + r.map((c, i) => ` ${채움(c ?? '', 열폭[i])} `).join('|') + '|';
  return [`\n## ${제목}`, '+' + 선('-') + '+', 행(머리), '+' + 선('=') + '+',
    ...줄들.map(행), '+' + 선('-') + '+', ''].join('\n');
}

function 사람표(결과) {
  const 줄 = [];
  줄.push('# T5 상태 계측기 — 칸 0');
  줄.push(`정본: ${계획서} §2 · 이 출력이 그 절을 대신한다(사람이 손으로 고치지 않는다)`);
  줄.push(`git: ${결과.git.head} (${결과.git.branch})${결과.git.dirty ? ' · 작업트리 더러움' : ''}`);
  줄.push('계측기는 판정하지 않는다 — 기계 사실만 적는다. 종료 코드는 항상 0.');

  줄.push(표('손 인벤토리 (descriptor 의 action enum)',
    ['손 id', '이름', '동사수', '동사', '기본손', '손 자리'],
    결과.hands.map((h) => [h.id, h.label ?? '', h.verbCount ?? '—',
      h.verbs ? h.verbs.join(' ') : 'enum 없음',
      h.handlerInDefaultRoom ? '○' : '✕', h.handlerSlotExists ? '○' : '✕'])));

  줄.push(표(`모델 노출 도구 — 서버 실기동 한 턴에서 캡처 (총 ${결과.modelExposedTools.count}개)`,
    ['#', '도구 이름'],
    결과.modelExposedTools.names.map((n, i) => [String(i + 1), n])));
  줄.push(`  캡처: ${결과.modelExposedTools.capturedFrom} · 모델 호출 ${결과.modelExposedTools.modelCalls}회`
    + ` (판마다 ${결과.modelExposedTools.perCall.join('/')}개)`);
  줄.push(`  격리: ${결과.modelExposedTools.isolation}`);
  줄.push(`  주입: ${결과.modelExposedTools.injection}`);

  줄.push(표('통제 채널 (model-control.js)',
    ['채널', 'operation enum'],
    결과.controlChannels.map((c) => [c.name, c.operations ? c.operations.join(' ') : 'enum 없음'])));

  줄.push(표('기관별 결손 (계획서 §4 상한 대조)',
    ['기관', '있는 동사', '요구 동사', '빠진 것'],
    결과.organs.map((o) => [`${o.번호} ${o.name}`,
      o.have.length ? o.have.join('\n') : '(없음)',
      String(o.required.length),
      o.missing.length ? o.missing.join(' · ') : '없음'])));
  for (const o of 결과.organs) {
    if (o.모호?.length) {
      줄.push(`  ${o.번호} ${o.name} · 계획서 문구인데 enum 에 1:1 로 못 거는 말: `
        + o.모호.map((m) => `「${m.계획서표현}」(${m.왜})`).join(', '));
    }
    // **경계와 결손은 다르다.** 안 여는 것이 설계인 자리를 「빠진 것」으로 세면 계측기가
    // 없는 결함을 만들어 낸다 — ⑥ 타이핑이 정확히 그랬다(PM 자기 정정 2026-08-11).
    if (o.주의) 줄.push(`  ${o.번호} ${o.name} · 주의: ${o.주의}`);
  }

  줄.push(표('부재 확인 (F-56 — 무엇을 찾았는지 함께 적는다)',
    ['대상', '질문', '훑은 파일', '생성전용 히트', '모호 히트'],
    결과.absence.map((a) => [a.subject, a.question, String(a.filesScanned),
      String(a.foundCount), String(a.ambiguousCount)])));
  for (const a of 결과.absence) {
    줄.push(`  ${a.subject}`);
    줄.push(`    검색어: ${a.searchedTerms.join(', ')}`);
    줄.push(`    경로:   ${a.searchedPaths.join(', ')}`);
    if (a.found.length) 줄.push(`    히트:   ${a.found.slice(0, 8).map((f) => `${f.term}@${f.at}`).join(', ')}`);
    else if (a.canClaimAbsence) {
      줄.push('    히트:   0건 — 위 검색어·경로 범위에서 관측되지 않았다');
      줄.push(`    ★ 대조:  이 자는 눈이 멀지 않았다 — ${a.control.말}@${a.control.자리} 를 실제로 잡는다`);
      줄.push(`             (${a.control.왜})`);
    } else {
      // **여기가 F-104 가 막는 자리다.** 대조가 안 서면 0건을 부재로 읽지 않는다.
      줄.push('    히트:   0건 — 그런데 **이 자로는 못 본다**(양성 대조 실패)');
      줄.push(`    ★ 경고:  ${a.control ? `대조 ${a.control.말}@${a.control.자리} 가 안 걸렸다` : '양성 대조가 없다'}`);
      줄.push('             이 줄을 「없다」로 읽지 마라 — 「안 봤다」와 구분이 안 된다(F-104)');
    }
    if (a.ambiguousCount) {
      줄.push(`    모호(읽기에도 쓰이는 말 — 부재의 반증이 아니다): `
        + a.ambiguous.slice(0, 6).map((f) => `${f.term}@${f.at}`).join(', ')
        + (a.ambiguousTruncated ? ' …' : ''));
    }
  }

  줄.push(표('확정 계열 — 대본 모델 관통 (서버·저장소·권한 판정은 진짜 · 모델 판단만 대본)',
    ['계열', '채널', '후보', '저장', '활성(선 것)', '활성 게이트', '섰나', '비고'],
    결과.settlementLineage.map((s) => [s.name, s.channel,
      s.candidateField ? `${s.candidateField}=${s.candidates}` : '—',
      `${s.settledField}=${s.stored}${s.seeded ? ` (씨앗 ${s.seeded} 뺀 값)` : ''}`,
      `${s.settled}`,
      s.gate ?? '—',
      s.settles ? '✅' : '❌',
      s.rejectedReason ? `확정 거절: ${s.rejectedReason}` : ''])));
  줄.push('  **「섰나」는 활성 열로 판정한다** — 저장은 됐는데 활성이 0 이면 그 계열은 안 선 것이다.');
  줄.push('  활성 판별은 계측기가 하지 않는다 — 제품이 쓰는 게이트 함수를 그대로 불러 센다(위 열).');
  줄.push('  저장>활성 이면 「만들어는 지는데 켜지지 않는다」는 뜻이고, 켜는 경로를 찾는 것이 그 계열의 일이다.');

  줄.push(`\n## 캐시 접두 안정성 (제품 원가 — 감사 비용이 아니다)`);
  줄.push(`  모델 호출 ${결과.cachePrefix.calls}회 중 안정 접두를 뜬 판 ${결과.cachePrefix.stableCaptured}개`);
  줄.push(`  안정 접두 지문 종류 수: ${결과.cachePrefix.systemStableShaKinds}`
    + ` (1 이 정상 · 여럿이면 그만큼 캐시가 안 먹는다) — ${결과.cachePrefix.systemStableShas.join(' ')}`);
  줄.push(`  안정부 크기 최소~최대: ${결과.cachePrefix.systemStableCharsMin}~${결과.cachePrefix.systemStableCharsMax}자`);
  줄.push(`  도구 목록 지문 종류 수: ${결과.cachePrefix.toolListShaKinds}`);
  줄.push(`  출처: ${결과.cachePrefix.source}`);

  const e = 결과.experience;
  const 못잼 = (v) => (v?.계측불가 ? `계측 불가 — ${v.사유}` : null);
  줄.push(`\n## 체감 지표 — 저장된 회차 기록 사후 집계`);
  줄.push(`  집계 대상: ${e.recordFiles}개 회차 기록 · ${e.turnsScanned}턴 (훑은 파일 ${e.filesScanned})`);
  줄.push(`  출처: ${e.source}`);
  줄.push(`  비율: ${e.비율}`);
  줄.push(`  ① 승인 대기로 끝난 턴: ${e.승인대기.count}건`
    + (e.승인대기.count ? ` — ${e.승인대기.turns.slice(0, 6).join(', ')}${e.승인대기.truncated ? ' …' : ''}` : ''));
  줄.push(`  ② 걸음 수(turnExchange): ${못잼(e.걸음수)
    ?? `최대 ${e.걸음수.max} · 중앙값 ${e.걸음수.median} (셀 수 있는 턴 ${e.걸음수.measurableTurns} · 기록 없는 턴 ${e.걸음수.기록없는턴})`}`);
  줄.push(`  ③ 거짓 건수: ${못잼(e.거짓건수)}`);
  줄.push(`  ④ 결과 없이 닫힌 턴: ${e.결과없이닫힌턴.count}건 — ${e.결과없이닫힌턴.정의}`);
  if (e.결과없이닫힌턴.count) {
    줄.push(`      ${e.결과없이닫힌턴.turns.slice(0, 8).join(', ')}${e.결과없이닫힌턴.truncated ? ' …' : ''}`);
  }
  if (e.결과없이닫힌턴.주의) 줄.push(`      ${e.결과없이닫힌턴.주의}`);
  줄.push(`  ⑤ ask.user — full schema 상시 노출 ${e.askUser.exposedToModel ? '있음' : '없음'}`
    + ` · selector 통로 ${e.askUser.availableViaSelector ? '있음' : '없음'}`
    + ` · 사용 횟수: ${못잼(e.askUser.usageCount)}`);
  줄.push(`      글자 히트 파일 ${e.askUser.글자히트파일수}개 — ${e.askUser.글자히트주의}`);
  줄.push(표('체감 지표 · 회차 묶음별 (합계는 여러 시험이 섞인 값이다 — 짚으려면 여기서 본다)',
    ['회차 묶음', '기록', '턴', '승인대기', '결과없이닫힘', '최대걸음', '중앙걸음', '걸음기록없음'],
    e.byRecordSet.map((b) => [b.set, String(b.files), String(b.turns), String(b.승인대기),
      String(b.결과없이닫힘), b.최대걸음 === null ? '기록없음' : String(b.최대걸음),
      b.중앙걸음 === null ? '기록없음' : String(b.중앙걸음), String(b.걸음기록없음)])));
  줄.push(`  집계에서 빠진 묶음 ${e.skippedSets.length}개: ${e.skippedSets.join(', ') || '없음'}`);
  줄.push(`    ${e.skippedNote}`);

  줄.push(`\n## 코드에서 파생한 그 밖의 사실`);
  줄.push(`  문서 읽기 형식: 확장자 ${결과.readFormats.extensions.length}개(${결과.readFormats.extensions.join(' ')})`
    + ` · 계열 ${결과.readFormats.familyCount}종(${결과.readFormats.families.join('·')})`);
  줄.push(`    출처: ${결과.readFormats.source}`);
  줄.push(`  브라우저 CDP 도메인: ${결과.browserCdp.domains.join(' · ')}`
    + ` · Input.* ${결과.browserCdp.hasInputDomain ? '있음' : '없음'}`);
  줄.push(`    메서드: ${결과.browserCdp.methods.join(' ')}`);
  줄.push(`    Input 검색어: ${결과.browserCdp.inputSearchedTerms.join(', ')} → 히트 ${결과.browserCdp.inputHits.length}건`);
  줄.push(`  창 예산 표: ${결과.windowTable.count}종 (${결과.windowTable.models.join(' · ')})`);
  줄.push(`  l5-growth 고아: ${결과.growthOrphans.orphanCount}건`
    + `${결과.growthOrphans.orphans.length ? ` — ${결과.growthOrphans.orphans.join(' ')}` : ''}`
    + ` (전체 ${결과.growthOrphans.files}개 중)`);
  줄.push(`    출처: ${결과.growthOrphans.source}`);

  줄.push(`\n## 미측정(유료 필요) — 값을 지어내지 않고 §2 를 인용한다`);
  if (!결과.paidOnly.available) 줄.push(`  ${결과.paidOnly.reason ?? '계획서 §2 를 못 떴다'}`);
  for (const p of 결과.paidOnly.items) {
    줄.push(`  · ${p.항목} · 상태: ${p.상태}`);
    줄.push(`      최종 측정값: ${p.최종측정값}`);
    줄.push(`      출처: ${p.출처}`);
    줄.push(`      재측정 명령: ${p.재측정명령}`);
  }

  줄.push(`\n## package.json 의존성`);
  줄.push(`  dependencies: ${결과.packageDeps.dependencies.length ? 결과.packageDeps.dependencies.join(', ') : '(0건)'}`);
  줄.push(`  devDependencies: ${결과.packageDeps.devDependencies.length ? 결과.packageDeps.devDependencies.join(', ') : '(0건)'}`);

  줄.push(`\n## 이 계측기가 **안 재는 것** (정직 부기)`);
  for (const m of 결과.unmeasured) 줄.push(`  · ${m}`);
  줄.push('');
  return 줄.join('\n');
}

/** 안 잰 것을 매번 함께 낸다 — 계측기 출력이 「전부 쟀다」로 읽히지 않게. */
const 미측정 = Object.freeze([
  '실모델 답 — 유료 호출 0 이므로 "모델이 뭐라고 답하나"(성질 1·2)는 여기서 안 잰다',
  '실기기 — 데스크톱·실브라우저·계정층을 안 만진다. 손이 실제로 먹히는지는 라이브 측정의 몫',
  '자력 완결·거짓 보고 — 사용자 문장 관통은 칸별 선빨강 시험이 잰다',
  '회귀 건수 — `npm test` 가 낸다(계측기가 검사를 대신 돌리지 않는다)',
  '시스템 프롬프트 글자 수 — 상황 파생이라 한 턴 값이 대표값이 아니다',
  '커넥터 실동작 — 코드 존재만 본다(계획서 §11 그대로 미측정)',
  '노출 상한 vs 실사용 노출 — 여기 수치는 모든 손을 껍데기로 주입한 **상한**이다',
]);

async function git정보() {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const 하나 = async (args) => {
    try { return (await run('git', args, { cwd: 저장소 })).stdout.trim(); }
    catch { return '(불명)'; }
  };
  const dirty = await 하나(['status', '--porcelain']);
  return {
    head: await 하나(['rev-parse', '--short', 'HEAD']),
    branch: await 하나(['rev-parse', '--abbrev-ref', 'HEAD']),
    dirty: dirty !== '' && dirty !== '(불명)',
  };
}

async function main() {
  const json = process.argv.includes('--json');
  const [hands, channels, absence, packageDeps, git, readFormats, browserCdp, windowTable,
    growthOrphans, planCitations] = await Promise.all([
    손인벤토리(), 통제채널(), 부재확인(), 의존성(), git정보(),
    문서읽기형식(), 브라우저CDP(), 창예산표(), 성장고아(), 계획서인용(),
  ]);
  const modelExposedTools = await 모델노출도구();

  // 대본 모델 관통 — 격리 임시 방 하나에서 확정 계열과 캐시 접두를 함께 뜬다.
  const 방 = await realpath(await mkdtemp(join(tmpdir(), 't5-state-probe-run-')));
  let settlement;
  let cachePrefix;
  try {
    const { 계열, 프롬프트판 } = await 확정계열({ 방, 상태: join(방, '.state') });
    settlement = 계열;
    cachePrefix = await 접두안정성(프롬프트판);
  } finally {
    await rm(방, { recursive: true, force: true });
  }

  // 체감 지표는 **저장된 회차 기록**을 읽는다 — `--records <자리>` 로 다른 회차 묶음을 줄 수 있다.
  const 회차인자 = process.argv.indexOf('--records');
  const recordsDir = 회차인자 > 0 ? process.argv[회차인자 + 1] : 회차기록뿌리;
  const experience = await 체감지표({ recordsDir, exposedNames: modelExposedTools.names });

  const organs = 기관결손({ hands, channels, absence });
  const 결과 = {
    probe: 'state-probe',
    canonicalPlan: 계획서,
    git,
    hands,
    modelExposedTools,
    controlChannels: channels,
    organs,
    absence,
    settlementLineage: settlement,
    cachePrefix,
    experience,
    readFormats,
    browserCdp,
    windowTable,
    growthOrphans,
    packageDeps,
    paidOnly: planCitations,
    unmeasured: [...미측정],
  };
  process.stdout.write(json ? `${JSON.stringify(결과, null, 2)}\n` : 사람표(결과));
}

// **종료 코드는 계측 결과로 갈리지 않는다** — 결손이 몇이든 0 이다(계측기는 판정하지 않는다).
// 다만 계측 자체가 못 돈 경우(임포트 실패·서버 기동 실패)는 0 이 아니다: 그때 0 을 내면
// "쟀는데 결손이 없다"와 "재지 못했다"가 같은 신호가 되고, 그게 오늘 세 번 틀린 그 병이다.
main().then(() => { process.exitCode = 0; }).catch((e) => {
  process.stderr.write(`[state-probe] 계측 불능(결과 아님): ${e?.stack ?? e}\n`);
  process.exitCode = 1;
});

export { 기관규격, 부재규격 };
