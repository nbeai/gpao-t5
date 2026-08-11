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
    // 계획서 §4⑥ 상한 + §9 결정② — 「읽기 위한 조작」은 두 손 모두 자동.
    상한: '①(읽기 위한 조작)까지 — 이동·타이핑·스크롤·탭 전환·뒤로. 폼 제출·구매·전송은 열지 않는다',
    계획서층: '1(신축) + 의도된 봉인',
    요구: [
      { 요구: '이동', 손: ['browser.observe:open', 'browser.act:navigate'] },
      { 요구: '스냅샷', 손: ['browser.observe:snapshot'] },
      { 요구: '스크롤', 손: ['browser.act:scroll'] },
      { 요구: '타이핑', 손: ['browser.act:type'] },
      { 요구: '탭 전환', 손: ['browser.act:tab', 'browser.act:switch_tab'] },
      { 요구: '뒤로', 손: ['browser.act:back'] },
    ],
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
      { 요구: 'xlsx 만들기', 부품: 'document-create' },
      { 요구: 'pdf 만들기', 부품: 'document-create' },
      { 요구: 'docx 만들기', 부품: 'document-create' },
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
// ─────────────────────────────────────────────────────────────────────────────
const 부재규격 = Object.freeze([
  {
    subject: 'document-create',
    질문: 'xlsx·pdf·docx 를 **만드는** 부품이 있나',
    경로: ['src', 'scripts', 'bin', 'vendor', 'package.json'],
    생성전용: ['exceljs', 'pdf-lib', 'jspdf', 'pdfmake', 'officegen', 'docxtemplater', 'excel4node',
      'xlsx-populate', 'sheetjs', 'XLSX.write', 'XLSX.utils.book_new', 'new Packer', 'wkhtmltopdf',
      'printToPDF', 'libreoffice', 'soffice', 'pandoc'],
    모호: ['PDFKit', 'PDFDocument', 'xlsx', 'docx', 'hwp'],
  },
  {
    subject: 'user-image-to-model',
    질문: '사용자 **파일** 이미지를 모델에게 실어 보내는 길이 있나',
    // 파일을 집는 손들만 본다 — 화면 손(desktop-*)은 이미 있는 길이라 여기서 세지 않는다.
    경로: ['src/runtime/local-file.js', 'src/runtime/document-intake.js', 'src/runtime/local-locate.js',
      'src/runtime/capsule.js', 'src/runtime/file-scope.js'],
    생성전용: ['그림:', 'image_url', 'input_image', 'inlineData', 'media_type', 'toBase64Image'],
    모호: ['image/', '.png', '.jpg', 'jpeg', 'base64'],
  },
  {
    subject: 'model-image-intake',
    질문: '그림을 모델에게 실어 보내는 **소비 지점**이 있나 (계획서: 세 공급자 블록)',
    경로: ['src/runtime/model-provider.js', 'src/runtime/chatgpt-model-client.js'],
    생성전용: ['image_url', 'input_image', 'inlineData', 'media_type'],
    모호: [],
  },
  {
    subject: 'connector-hands',
    질문: 'connector.declare · connector.connect 손이 코드에 있나',
    경로: ['src'],
    생성전용: ['makeConnectorDeclareTool', 'makeConnectorConnectTool'],
    모호: ['connector.declare', 'connector.connect'],
  },
  {
    subject: 'channel-inbox',
    질문: '받은 것을 **조회**하는 손이 있나 (계획서 ⑦: 와이어 28개 중 0)',
    경로: ['src/surface/demo-context.js', 'src/surface/live-context.js', 'src/runtime'],
    생성전용: ['makeChannelInbox', 'inboxTool', "id: 'telegram.inbox'", "id: 'slack.inbox'", "id: 'mail.inbox'"],
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
    결과.push({
      subject: 규격.subject,
      question: 규격.질문,
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

  const 대본 = { 낼것: () => ({ text: '네.', toolCalls: [] }) };
  const 프롬프트판 = [];
  const { buildModelMessages } = await import(join(저장소, 'src/runtime/model-provider.js'));
  const 가짜모델 = {
    async respond(tc, opts = {}) {
      // **캐시 접두 계측을 같은 관통에서 뜬다** — 프롬프트 조립은 진짜다(모델 판단만 대본).
      try {
        const m = buildModelMessages(tc);
        프롬프트판.push({ systemStable: m.systemStable ?? null, tools: opts.tools ?? [] });
      } catch { /* 조립이 안 되면 그 판은 안 센다 — 지어내지 않는다 */ }
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
      const 확정수 = Math.max(0, (사진[계열.확정칸]?.length ?? 0) - 원래확정);
      결과.push({
        key: 계열.key, name: 계열.name, channel: 계열.채널, utterance: 계열.발화,
        candidateField: 계열.후보칸 ?? null, candidates: 후보수,
        settledField: 계열.확정칸, settled: 확정수,
        seeded: 원래확정,
        settles: 확정수 > 0,
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
    ['손 id', '이름', '동사수', '동사', '기본손', '주입가능'],
    결과.hands.map((h) => [h.id, h.label ?? '', h.verbCount ?? '—',
      h.verbs ? h.verbs.join(' ') : 'enum 없음',
      h.handlerInDefaultRoom ? '○' : '✕', h.handlerInjectable ? '○' : '✕'])));

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
    else 줄.push('    히트:   0건 — 위 검색어·경로 범위에서 관측되지 않았다');
    if (a.ambiguousCount) {
      줄.push(`    모호(읽기에도 쓰이는 말 — 부재의 반증이 아니다): `
        + a.ambiguous.slice(0, 6).map((f) => `${f.term}@${f.at}`).join(', ')
        + (a.ambiguousTruncated ? ' …' : ''));
    }
  }

  줄.push(표('확정 계열 — 대본 모델 관통 (서버·저장소·권한 판정은 진짜 · 모델 판단만 대본)',
    ['계열', '채널', '후보', '확정', '섰나', '비고'],
    결과.settlementLineage.map((s) => [s.name, s.channel,
      s.candidateField ? `${s.candidateField}=${s.candidates}` : '—',
      `${s.settledField}=${s.settled}${s.seeded ? ` (씨앗 ${s.seeded} 뺀 값)` : ''}`,
      s.settles ? '✅' : '❌',
      s.rejectedReason ? `확정 거절: ${s.rejectedReason}` : ''])));

  줄.push(`\n## 캐시 접두 안정성 (제품 원가 — 감사 비용이 아니다)`);
  줄.push(`  모델 호출 ${결과.cachePrefix.calls}회 중 안정 접두를 뜬 판 ${결과.cachePrefix.stableCaptured}개`);
  줄.push(`  안정 접두 지문 종류 수: ${결과.cachePrefix.systemStableShaKinds}`
    + ` (1 이 정상 · 여럿이면 그만큼 캐시가 안 먹는다) — ${결과.cachePrefix.systemStableShas.join(' ')}`);
  줄.push(`  안정부 크기 최소~최대: ${결과.cachePrefix.systemStableCharsMin}~${결과.cachePrefix.systemStableCharsMax}자`);
  줄.push(`  도구 목록 지문 종류 수: ${결과.cachePrefix.toolListShaKinds}`);
  줄.push(`  출처: ${결과.cachePrefix.source}`);

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
