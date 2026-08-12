// **자산 채점기 — ①②③④ 를 층별로 따로 잰다** (design/T5-ASSET-SCORECARD-ko.md).
//
// 왜 있나(오너 지시 2026-08-12): 앞선 조사가 「T5 가 이미 가진 자산」 목록을 냈는데, 그 문서가
// **자기가 지적한 병에 걸려 있었다** — 「쓸 수 있다」를 「코드가 있다」로 적었다.
// 그래서 층을 갈라 잰다. 섞으면 또 같은 문서가 나온다.
//
//   ① 코드가 있다        파일:줄 로 지목된다              — 이 대본이 안 잰다(사람이 grep 한다)
//   ② 제품 경로가 닿는다   호출자 사슬이 실재한다            — 이 대본이 안 잰다(사람이 읽는다)
//   ③ 모델이 그 능력을 안다 도구 스키마·설명서에 실린다       — **이 대본이 잰다**(손제시 덤프)
//   ④ 라이브에서 실제로 쓴다 실물 발화로 N회 중 M회           — **이 대본이 잰다**(원장·기준자)
//
// ③ 이 오늘 두 번 T5 를 죽인 자리다: `local.locate` 형식 세기는 ①②가 다 섰는데 설명서에 없어
// 3/3 이 안 썼고, 진짜 xlsx 생성은 7/7 이 시도조차 안 했다. **설명서 한 줄**로 둘 다 닫혔다.
// 그러니 ③ 을 「스키마에 파라미터가 있다」로 재지 않는다 — **모델에게 실제로 나간 바이트**를 잰다.
//
// ── 규율 넷 (앞 대본들이 피 흘려 얻은 것 · 여기서 다시 밟지 않는다) ──────────────
//  ① **채점을 T5 말로 하지 않는다.** 판정은 원장(`ledgerEntries.actualCall.tool`)과
//     독립 기준자(파일시스템·개수)가 한다. 답글은 참고로만 적는다.
//  ② **못 잰 것을 0 이나 ✕ 로 적지 않는다.** `계측불가` 다 — 안 잰 것과 안 되는 것은 다르다.
//  ③ **오너 자리를 안 건드린다.** 상태 자리·파일 뿌리를 임시 방으로 물리고, 오너 자리에서는
//     `model-connection.json` 만 **읽어서 복사**한다(자격 사본은 임시 방과 함께 사라진다).
//     ⚠️ `GPAO_T5_FILE_ROOTS` 를 반드시 물린다 — 기본값은 **홈 전체**(`file-scope.js:60`)라
//     안 물리면 라이브 쓰기·이동 회차가 오너 파일을 만진다.
//  ④ **브라우저 탭을 안 연다.** `bin/gpao-t5.mjs` 를 spawn 하지 않고 `startLiveServer` 를
//     직접 부른다(그 진입점은 기동마다 오너 크롬에 탭을 연다 — 2026-08-12 실제 피해).
//     `startLiveServer` 는 `liveDeps` 를 지나므로 손은 제품과 같은 집합으로 선다(server.js:4110).
//
// 쓰는 법:
//   node scripts/live/asset-scorecard.mjs              # 전부 · 회차 3
//   node scripts/live/asset-scorecard.mjs --n=3 --only=local.file
//   node scripts/live/asset-scorecard.mjs --손제시만    # ③ 만 잰다(모델 안 부름 · 몇 초)
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const 저장소 = resolve(new URL('../..', import.meta.url).pathname);
const 잠깐 = (ms) => new Promise((ok) => setTimeout(ok, ms));

// ── 독립 기준자 ────────────────────────────────────────────────────────────
// T5 영수증을 안 쓴다. 이게 이 대본이 앞 문서와 다른 점 전부다.
const 기준자 = {
  파일있나: (p) => existsSync(p),
  async 내용(p) { return existsSync(p) ? readFile(p, 'utf8').catch(() => null) : null; },
  /** 확장자로 실제 개수를 센다 — 모델이 말한 수와 대조할 참값. */
  async 확장자수(방, 확장자) {
    const 목록 = await readdir(방).catch(() => []);
    return 목록.filter((f) => f.toLowerCase().endsWith(확장자)).length;
  },
  /** `file` 이 **내용**으로 뭐라 읽는가. 확장자만 맞는 빈 파일을 통과시키지 않는다. */
  async 무슨파일(p) {
    if (!existsSync(p)) return null;
    try { const { stdout } = await run('file', ['-b', p]); return stdout.trim(); } catch { return null; }
  },
};

/**
 * **고정물** — 회차마다 같은 자리에서 다시 만든다. 앞 회차가 남긴 것이 다음 회차의 답이 되면
 * 「되더라」가 우연이 된다. 개수 문항이 특히 그렇다.
 */
const 고정물 = Object.freeze({
  '견적서_8월.txt': '성수동 리모델링 견적\n총액: 성수-7742\n담당: 김철수\n',
  '회의록.txt': '8월 정기회의\n안건: 이사 일정\n',
  '메모.txt': '우유 사기\n',
  '계약서.txt': '임대차 계약\n',
  '보고서_1.pdf': '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n',
  '보고서_2.pdf': '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n',
  '보고서_3.pdf': '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n',
});

/**
 * **진짜 `.docx` 하나** — 오늘의 세 번 밟은 병을 네 번째로 재는 자리다.
 *
 * `local.file read` 는 pdf·docx·xlsx·hwpx·hwp 본문을 실제로 꺼낸다
 * (`local-file.js:783 extractDocument` · 형식표 `document-intake.js:9`).
 * 그런데 **모델이 읽는 설명**(`demo-context.js:751 schema.description` · `:735 capability`)에는
 * 그 사실이 한 글자도 없다. `local.locate` 형식 세기·`.xlsx` 생성과 **정확히 같은 모양**이다.
 * 그러니 "설명서에 없으면 안 쓴다"가 참인지 여기서 잰다 — 가설이 아니라 회차로.
 *
 * `.docx` 는 zip 이라 의존성 없이 손으로 짤 수 있다(최소 3부품).
 */
async function docx만들기(자리) {
  const { execFile } = await import('node:child_process');
  const 임시 = await mkdtemp(join(tmpdir(), 'docx-'));
  await mkdir(join(임시, '_rels'), { recursive: true });
  await mkdir(join(임시, 'word'), { recursive: true });
  await writeFile(join(임시, '[Content_Types].xml'), '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>', 'utf8');
  await writeFile(join(임시, '_rels/.rels'), '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>', 'utf8');
  await writeFile(join(임시, 'word/document.xml'), '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r>'
    + '<w:t>계약 금액은 구름-5591 원입니다.</w:t></w:r></w:p></w:body></w:document>', 'utf8');
  await promisify(execFile)('zip', ['-q', '-r', 자리, '[Content_Types].xml', '_rels', 'word'], { cwd: 임시 });
  await rm(임시, { recursive: true, force: true });
}

async function 고정물깔기(파일방) {
  await rm(파일방, { recursive: true, force: true });
  await mkdir(join(파일방, '보관'), { recursive: true });
  for (const [이름, 내용] of Object.entries(고정물)) await writeFile(join(파일방, 이름), 내용, 'utf8');
  await docx만들기(join(파일방, '계약서_최종.docx'));
}

/**
 * **동결 문장표.** 여기 없는 문장은 안 잰다 — 즉흥으로 시키면 회차끼리 비교가 안 된다.
 *
 * `기대손` 은 ④ 의 앞쪽 절반(그 손을 실제로 잡았나)이고, `판정` 은 뒤쪽 절반
 * (사용자 목적이 실제로 이뤄졌나)이다. **둘을 따로 적는다** — 손은 잡았는데 결과가 틀린 것과
 * 손을 아예 안 잡은 것은 고치는 자리가 다르다(전자는 손, 후자는 설명서).
 *
 * `판정` 이 `null` 을 돌려주면 그 줄은 `계측불가` 다. 0 으로 적지 않는다.
 */
export const 문장표 = Object.freeze([
  // ── local.file 넷 ────────────────────────────────────────────────────
  {
    칸: 'local.file 읽기', 기대손: ['local.file'],
    문장: '견적서_8월.txt 열어서 총액이 얼마인지 알려줘.',
    // 기준자: 파일 안에만 있는 토막이 답에 실렸나. T5 가 「읽었다」고 말하는 것으로 안 센다.
    판정: async ({ 답 }) => ({ 사실: `답에 "성수-7742" ${답.includes('성수-7742') ? '있음' : '없음'}`, 통과: 답.includes('성수-7742') }),
  },
  {
    칸: 'local.file 쓰기', 기대손: ['local.file'],
    문장: '오늘할일.txt 만들고 "우산 챙기기" 라고 적어줘.',
    판정: async ({ 파일방 }) => {
      const 내용 = await 기준자.내용(join(파일방, '오늘할일.txt'));
      return { 사실: 내용 === null ? '그 자리에 파일이 없다' : `내용=${JSON.stringify(내용.slice(0, 40))}`,
        통과: Boolean(내용 && 내용.includes('우산')) };
    },
  },
  {
    칸: 'local.file 이동', 기대손: ['local.file'],
    문장: '회의록.txt 를 보관 폴더로 옮겨줘.',
    판정: async ({ 파일방 }) => {
      const 새 = 기준자.파일있나(join(파일방, '보관/회의록.txt'));
      const 옛 = 기준자.파일있나(join(파일방, '회의록.txt'));
      return { 사실: `보관/회의록.txt=${새} · 원래자리=${옛}`, 통과: 새 && !옛 };
    },
  },
  {
    // **되돌리기는 앞 문장에 매달린다** — 같은 세션에서 이어 친다(아래 `이어치기`).
    칸: 'local.file 되돌리기', 기대손: ['local.file'], 이어치기: 'local.file 이동',
    문장: '방금 옮긴 거 취소해줘.',
    판정: async ({ 파일방 }) => {
      const 새 = 기준자.파일있나(join(파일방, '보관/회의록.txt'));
      const 옛 = 기준자.파일있나(join(파일방, '회의록.txt'));
      return { 사실: `보관/회의록.txt=${새} · 원래자리=${옛}`, 통과: 옛 && !새 };
    },
  },
  {
    // ★★ **네 번째 같은 병을 재는 자리**(위 `docx만들기` 주석 참조).
    // ④ 를 두 축으로 갈라 본다 — `local.file:read` 로 갔나(설명서가 닿았다),
    // 아니면 `local.terminal`·`local.capsule` 로 우회했나(설명서가 안 닿았다).
    칸: '문서읽기(docx)', 기대손: ['local.file'],
    문장: '계약서_최종.docx 열어서 계약 금액이 얼마인지 알려줘.',
    판정: async ({ 답, 손 }) => {
      const 우회 = 손.some((x) => ['local.terminal', 'local.capsule'].includes(x.tool));
      const 정도 = 손.some((x) => x.tool === 'local.file' && x.action === 'read');
      return { 사실: `답에 "구름-5591" ${답.includes('구름-5591') ? '있음' : '없음'}`
        + ` · local.file:read=${정도} · 셸/캡슐 우회=${우회}`,
        통과: 답.includes('구름-5591') };
    },
  },
  // ── local.locate 셋 ──────────────────────────────────────────────────
  {
    칸: 'local.locate 이름', 기대손: ['local.locate'],
    문장: '견적이라는 이름 들어간 파일 찾아줘.',
    판정: async ({ 답 }) => ({ 사실: `답에 "견적서_8월" ${답.includes('견적서_8월') ? '있음' : '없음'}`,
      통과: 답.includes('견적서_8월') }),
  },
  {
    // ★ **오늘 죽었던 자리.** ①②는 섰는데 설명서에 없어 3/3 이 캡슐을 직접 짰다.
    칸: 'local.locate 형식', 기대손: ['local.locate'],
    문장: '내 컴퓨터에 pdf 파일이 몇 개나 있어?',
    판정: async ({ 답, 파일방 }) => {
      const 참 = await 기준자.확장자수(파일방, '.pdf');
      // 숫자와 한글수사를 함께 본다 — "세 개"도 맞는 답이다.
      const 한글 = ['영', '한', '두', '세', '네', '다섯', '여섯', '일곱'][참] ?? ' ';
      const 맞음 = new RegExp(`(^|[^0-9])${참}( ?개|개|건)`).test(답) || 답.includes(`${한글} 개`) || 답.includes(`${한글}개`);
      return { 사실: `참값 ${참}개 · 답에 그 수 ${맞음 ? '있음' : '없음'}`, 통과: 맞음 };
    },
  },
  {
    칸: 'local.locate 개수', 기대손: ['local.locate'],
    문장: '내 파일이 전부 몇 개야?',
    판정: async ({ 답, 파일방 }) => {
      const 목록 = await readdir(파일방).catch(() => []);
      const 참 = 목록.filter((f) => !f.startsWith('.')).length;   // 폴더 `보관` 포함
      const 맞음 = new RegExp(`(^|[^0-9])${참}( ?개|개|건)`).test(답)
        || new RegExp(`(^|[^0-9])${참 - 1}( ?개|개|건)`).test(답);   // 폴더를 빼고 세는 것도 참으로 본다
      return { 사실: `참값 ${참}개(폴더 포함) · 답=${맞음 ? '맞음' : '다름'}`, 통과: 맞음 };
    },
  },
  // ── local.terminal ───────────────────────────────────────────────────
  {
    // **읽기 명령 하나만.** 쓰기·파괴 명령은 이 대본이 안 친다.
    칸: 'local.terminal', 기대손: ['local.terminal'],
    문장: '터미널로 node 버전 좀 확인해줘.',
    판정: async ({ 답 }) => {
      const 참 = process.version;                       // v24.x.x
      const 큰 = 참.split('.')[0];                       // v24
      return { 사실: `참값 ${참} · 답에 ${큰} ${답.includes(큰) ? '있음' : '없음'}`, 통과: 답.includes(큰) };
    },
  },
  // ── 웹 둘 ────────────────────────────────────────────────────────────
  {
    칸: 'web.search', 기대손: ['web.search'],
    문장: '올해 노벨 문학상 누가 받았는지 검색해서 알려줘.',
    // 기준자를 답 내용으로 잡을 수 없다(정답을 내가 모른다 · 모델 지식으로도 답할 수 있다).
    // **그래서 판정은 원장이 한다** — 아래 `기대손` 이 실제로 delivered 였나.
    판정: async () => null,   // 계측불가로 적고, ④ 는 손 기록으로만 센다
  },
  {
    칸: 'web.collect', 기대손: ['web.collect'],
    문장: 'https://example.com 페이지 열어서 뭐라고 써 있는지 알려줘.',
    판정: async ({ 답 }) => ({ sample: true, 사실: `답에 "Example Domain" 계열 ${/example domain|예시 도메인|illustrative/i.test(답) ? '있음' : '없음'}`,
      통과: /example domain|예시 도메인|illustrative/i.test(답) }),
  },
  // ── 브라우저 둘 (열고 읽기만 · 타이핑 안 함) ─────────────────────────
  {
    칸: 'browser.observe', 기대손: ['browser.observe', 'browser.act'],
    문장: '브라우저로 example.com 열어서 화면에 뭐가 보이는지 읽어줘.',
    판정: async ({ 답 }) => ({ 사실: `답에 "Example Domain" 계열 ${/example domain|예시 도메인/i.test(답) ? '있음' : '없음'}`,
      통과: /example domain|예시 도메인/i.test(답) }),
  },
  // ── 지난 대화 찾기 ───────────────────────────────────────────────────
  {
    // 앞 회차들이 같은 자리에 세션을 쌓아 둔 뒤에 친다(문장표 순서가 곧 조건이다).
    칸: 'session.search', 기대손: ['session.search'],
    문장: '아까 견적서 총액 물어봤을 때 얼마라고 했었지? 지난 대화에서 찾아줘.',
    판정: async ({ 답 }) => ({ 사실: `답에 "7742" ${답.includes('7742') ? '있음' : '없음'}`, 통과: 답.includes('7742') }),
  },
  // ── ★ agent.delegate — 오늘 아무도 안 밟았다 ─────────────────────────
  {
    칸: 'agent.delegate', 기대손: ['agent.delegate'],
    문장: '내 파일들 훑어서 무슨 문서들인지 정리해줘. 오래 걸리면 따로 맡겨서 해도 돼.',
    판정: async () => null,   // 사용자 목적 판정 자를 못 세웠다 — ④ 는 손 기록으로만 센다
  },
  // ── 이 컴퓨터를 아는 손 셋 ───────────────────────────────────────────
  {
    칸: 'local.process', 기대손: ['local.process'],
    문장: '지금 이 컴퓨터에서 돌고 있는 프로그램 중에 메모리 많이 쓰는 거 알려줘.',
    판정: async () => null,
  },
  {
    칸: 'local.system', 기대손: ['local.system'],
    문장: '이 맥 디스크 여유 공간이 얼마나 남았어?',
    판정: async () => null,
  },
  {
    칸: 'local.discovery', 기대손: ['local.discovery'],
    문장: '내 컴퓨터에 어떤 앱들이 깔려 있는지 좀 봐줘.',
    판정: async () => null,
  },
  // ── 기억 ─────────────────────────────────────────────────────────────
  {
    칸: '기억', 기대손: [],   // 손이 아니라 모델제어(memory.propose)다
    문장: '앞으로 답변할 때는 항상 결론부터 먼저 말해줘.',
    // 기준자: **memory.json 실물**. T5 가 "기억했어요"라고 말하는 것으로 안 센다.
    판정: async ({ 자리 }) => {
      const 원문 = await readFile(join(자리, 'memory.json'), 'utf8').catch(() => null);
      if (원문 === null) return { 사실: 'memory.json 이 없다', 통과: false };
      const m = JSON.parse(원문);
      const 후보 = [...(m.candidates ?? []), ...(m.promoted ?? [])];
      const 걸림 = 후보.filter((c) => /결론/.test(String(c.statement ?? '')));
      return { 사실: `memory.json 후보 ${m.candidates?.length ?? 0} · 승격 ${m.promoted?.length ?? 0} · "결론" 담은 것 ${걸림.length}`,
        통과: 걸림.length > 0 };
    },
  },
]);

async function 방만들기() {
  const 방 = await mkdtemp(join(tmpdir(), 't5-scorecard-'));
  await mkdir(join(방, 'state'), { recursive: true });
  await mkdir(join(방, 'files'), { recursive: true });
  await mkdir(join(방, 'dump'), { recursive: true });
  // **모델 연결만 옮긴다.** 안 옮기면 stub 모델로 떠서 회차가 0.1초에 끝나고,
  // 그걸 「빠르다」로 읽으면 전부 거짓 음성이 된다(2026-08-12 밟음).
  // 오너 자리는 **읽기만** 한다.
  const 원 = join(homedir(), '.local/state/gpao-t5/sessions');
  for (const f of ['model-connection.json', 'install.json']) {
    if (existsSync(join(원, f))) await copyFile(join(원, f), join(방, 'state', f));
  }
  // ★ **덤프 스위치는 `process.env` 에도 심는다.** 커널은 `ctx.processEnv ?? process.env` 를
  // 읽는데(`turn.js:976`), 그 `ctx.processEnv` 가 서버 옵션까지 안 이어지는 경로가 있다 —
  // 첫 판에서 덤프방이 **빈 채로** 나왔고, 하마터면 「③ 을 못 잰다」로 적을 뻔했다(밟음).
  process.env.GPAO_T5_PROMPT_DUMP = join(방, 'dump');
  return 방;
}

async function 서버띄우기(방) {
  const { startLiveServer } = await import(join(저장소, 'src/surface/server.js'));
  return startLiveServer({
    port: 0,                                    // OS 가 준다 — 포트를 박으면 남의 서버와 말한다
    startScheduler: false,                      // 자동화 틱은 이 회차의 관심사가 아니다
    enableAgentDelegation: true,                // 제품 진입점과 같게(server.js:4160)
    processEnv: {
      ...process.env,
      GPAO_T5_DATA_DIR: join(방, 'state'),
      // ★★ **`GPAO_T5_FILE_ROOTS` 하나로는 가둬지지 않는다**(밟음 2026-08-12 · 첫 회차에서
      // 모델이 오너의 실제 `~/GPAO-T5/2026-08 정산/` 을 열어 읽었다). 파일 손의 강제는
      // `[...roots, home ?? homedir()]` 이라(`local-file.js:473,482,487,539,594,959,1092,1144`)
      // 선언 뿌리는 **더하기만 하고 좁히지 못한다**. 이건 결함이 아니라 설계다 —
      // 「홈이 방이다」(`file-scope.js:44~60`, 오너 결정 2026-08-07). 그러니 **홈을 옮긴다.**
      // `local.file` 도 `local.locate` 도 `GPAO_T5_HOME` 을 홈으로 받는다(`live-context.js:105,223,230`).
      // 이걸 안 하고 쓰기·이동·되돌리기 회차를 돌리면 **오너 파일을 만진다.**
      GPAO_T5_HOME: join(방, 'files'),
      GPAO_T5_FILE_ROOTS: join(방, 'files'),
      GPAO_T5_PROMPT_DUMP: join(방, 'dump'),    // ③ 을 재는 자리
    },
  });
}

/** ③ — **모델에게 실제로 나간 것**을 읽는다. 스키마에 있다가 아니라 나갔다를 잰다. */
async function 손제시읽기(덤프방) {
  const 파일들 = (await readdir(덤프방).catch(() => [])).filter((f) => f.includes('손제시'));
  const 준것 = new Set(); const 거른것 = new Map();
  for (const f of 파일들) {
    const j = JSON.parse(await readFile(join(덤프방, f), 'utf8').catch(() => '{}'));
    for (const id of j.준것 ?? []) 준것.add(id);
    for (const x of j.거른것 ?? []) 거른것.set(x.id, x.이유);
  }
  return { 준것: [...준것].sort(), 거른것: [...거른것.entries()].sort() };
}

/** 입력 덤프에서 **도구 설명 원문**을 꺼낸다 — ③ 의 알맹이다(이름만 실리고 설명이 빈 것을 잡는다). */
async function 스키마읽기(덤프방) {
  const 파일들 = (await readdir(덤프방).catch(() => [])).filter((f) => f.includes('-in-'));
  const 표 = new Map();
  for (const f of 파일들) {
    const j = JSON.parse(await readFile(join(덤프방, f), 'utf8').catch(() => '{}'));
    for (const t of j.tools ?? []) {
      const 이름 = typeof t === 'string' ? t : (t.name ?? t.id);
      if (!이름 || 표.has(이름)) continue;
      const 설명 = typeof t === 'string' ? '' : String(t.description ?? t.설명 ?? '');
      표.set(이름, { 설명자수: 설명.length, 첫줄: 설명.split('\n')[0].slice(0, 90) });
    }
  }
  return [...표.entries()].sort();
}

/** 한 문장을 끝까지 밟는다. 승인 카드는 세고 승인한다 — 카드 수가 곧 「사용자 손」이다. */
async function 한문장(base, cookie, 항목, 방, 세션물림) {
  const post = async (body) => fetch(`${base}/turn`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body),
  }).then((r) => r.json());

  // `이어치기` 가 있으면 **그 문장이 쓴 세션에 이어 친다** — 되돌리기는 앞 걸음에 매달린다.
  const 세션 = 항목.이어치기 && 세션물림.get(항목.이어치기)
    ? { id: 세션물림.get(항목.이어치기) }
    : await fetch(`${base}/sessions`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: '{}' })
      .then((r) => r.json());
  세션물림.set(항목.칸, 세션.id);

  const 시작 = Date.now();
  let 결과 = await post({ sessionId: 세션.id, text: 항목.문장 });
  let 카드 = 0;
  while (결과?.kind === 'approval' && 카드 < 4) { 카드 += 1; 결과 = await post({ sessionId: 세션.id, approve: 결과.pendingId }); }
  const 걸린 = Math.round((Date.now() - 시작) / 1000);

  // **응답과 저장은 다른 시각이다** — 파일이 멎을 때까지 기다린 뒤 읽는다(2026-08-12 밟음).
  await 잠깐(1200);

  const 답 = String(결과?.reply ?? 결과?.result?.reply ?? '');
  // ④ 앞쪽 절반 — **원장**이 말하는 실제 호출. T5 산문이 아니다.
  const 교환 = 결과?.turnExchange ?? [];
  const 손 = 교환.map((x) => ({ tool: x.tool, action: x.args?.action ?? null, lifecycle: x.lifecycle ?? x.failureState ?? null }));
  const 밟은손 = new Set(손.map((x) => x.tool));
  const 손밟음 = 항목.기대손.length === 0 ? null : 항목.기대손.some((t) => 밟은손.has(t));

  let 판정 = null;
  try { 판정 = await 항목.판정({ 답, 손, 파일방: join(방, 'files'), 자리: join(방, 'state') }); }
  catch (e) { 판정 = { 사실: `기준자가 죽었다: ${e.message}`, 통과: null }; }

  return {
    칸: 항목.칸, 문장: 항목.문장, 세션: 세션.id, 카드, 걸린,
    손밟음, 손: 손.map((x) => `${x.tool}${x.action ? ':' + x.action : ''}(${x.lifecycle ?? '?'})`),
    통과: 판정?.통과 ?? null, 사실: 판정?.사실 ?? '기준자 없음 — 계측불가',
    답: 답.slice(0, 300),
  };
}

function 표그리기(회차들, 목록) {
  const 기호 = (v) => (v === true ? '○' : v === false ? '✕' : '—');
  const out = ['', '── 자산 채점 회차 ────────────────────────────────────────────────'];
  for (const 항목 of 목록) {
    const 줄 = 회차들.flat().filter((r) => r.칸 === 항목.칸);
    const n = 줄.length;
    const 손M = 줄.filter((r) => r.손밟음 === true).length;
    const 목M = 줄.filter((r) => r.통과 === true).length;
    const 목잼 = 줄.some((r) => r.통과 !== null);
    out.push(`[${항목.칸}]  손밟음 ${항목.기대손.length ? `${손M}/${n}` : '해당없음'}`
      + `  ·  목적달성 ${목잼 ? `${목M}/${n}` : '계측불가(자 없음)'}`
      + `  ·  카드 ${줄.map((r) => r.카드).join('/')}`);
    for (const r of 줄) out.push(`     ${기호(r.통과)} ${r.걸린}초 · 손: ${r.손.join(' ') || '없음'} · ${r.사실}`);
  }
  return out.join('\n');
}

export async function 회차돌기({ n = 3, only = '' } = {}) {
  const 목록 = only ? 문장표.filter((x) => x.칸.includes(only) || x.문장.includes(only)) : 문장표;
  if (!목록.length) throw new Error(`--only=${only} 에 걸리는 문장이 없다`);
  const 방 = await 방만들기();
  const server = await 서버띄우기(방);
  const base = `http://127.0.0.1:${server.address().port}`;
  const 회차들 = [];
  try {
    const cookie = ((await fetch(`${base}/`)).headers.get('set-cookie') ?? '').split(';')[0];
    for (let i = 1; i <= n; i += 1) {
      await 고정물깔기(join(방, 'files'));   // 회차마다 판을 새로 깐다
      const 세션물림 = new Map();
      const 줄들 = [];
      for (const 항목 of 목록) {
        const r = await 한문장(base, cookie, 항목, 방, 세션물림);
        console.log(`  회차${i} [${항목.칸}] ${r.통과 === true ? '○' : r.통과 === false ? '✕' : '—'}`
          + ` · ${r.걸린}초 · 손:${r.손.join(' ') || '없음'} · ${r.사실}`);
        줄들.push(r);
      }
      회차들.push(줄들);
    }
    const 제시 = await 손제시읽기(join(방, 'dump'));
    const 스키마 = await 스키마읽기(join(방, 'dump'));
    await writeFile(join(방, '회차.json'), JSON.stringify({ 방, 회차들, 제시, 스키마 }, null, 2), 'utf8');
    return { 방, 회차들, 목록, 제시, 스키마 };
  } finally {
    // ⚠️ **`process.exit` 금지** — `finally` 를 건너뛰면 좀비 서버가 남아 다음 회차를 오염시킨다.
    await new Promise((ok) => server.close(ok));
  }
}

/** ③ 만 잰다 — 모델을 안 부른다(몇 초). 서버를 띄워 손 목록·설명 원문만 꺼낸다. */
export async function 손제시만() {
  const 방 = await 방만들기();
  const server = await 서버띄우기(방);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const cookie = ((await fetch(`${base}/`)).headers.get('set-cookie') ?? '').split(';')[0];
    const 자기 = await fetch(`${base}/toolbox`, { headers: { cookie } }).then((r) => r.json()).catch(() => null);
    return { 방, 자기 };
  } finally { await new Promise((ok) => server.close(ok)); }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const 인자 = (k, d) => (process.argv.slice(2).find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=').slice(1).join('=');
  if (process.argv.includes('--손제시만')) {
    const { 방, 자기 } = await 손제시만();
    console.log(JSON.stringify(자기, null, 2).slice(0, 20000));
    console.log(`\n방: ${방}`);
  } else {
    const { 방, 회차들, 목록, 제시, 스키마 } = await 회차돌기({ n: Number(인자('n', 3)), only: 인자('only', '') });
    console.log(표그리기(회차들, 목록));
    console.log('\n── ③ 모델에게 실제로 나간 손 ──');
    console.log(`준 것 (${제시.준것.length}): ${제시.준것.join(' ')}`);
    console.log(`거른 것 (${제시.거른것.length}): ${제시.거른것.map(([id, 이유]) => `${id}=${이유}`).join(' · ')}`);
    console.log('\n── ③ 도구 설명 원문 크기(모델이 받은 바이트) ──');
    for (const [이름, v] of 스키마) console.log(`  ${이름.padEnd(20)} ${String(v.설명자수).padStart(5)}자 · ${v.첫줄}`);
    console.log(`\n회차 원본: ${방}/회차.json`);
  }
}
