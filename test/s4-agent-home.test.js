// **S4 — 집과 설정을 나누고, 수명을 선언한다.**
//
// 원리 ⑥: *"The workspace is the agent's home… treat it as memory."*
// 집(사용자가 열어 고치고 백업하는 파일들)과 설정·상태(자격·세션·열쇠)는 다른 자리다.
//
// T5 의 현재 상태:
//   · `SOUL.md`·`CAPABILITIES.md` 가 **`~/.local/state/gpao-t5/sessions/`** 에 있다.
//     그건 XDG 관례상 **상태 디렉터리**다 — 사용자가 열어 볼 자리가 아니다.
//   · **운영 지침이 없다.** T5 가 어떻게 행동할지는 전부 `judgmentCharter()` 에 박혀 있고
//     사용자는 한 글자도 못 고친다. 비교군 넷은 모두 이걸 파일로 준다(AGENTS.md 계열).
//   · **사용자가 누구인지 적을 자리도 없다.**
//
// 수명은 T5 가 이미 절반 갖고 있다 — 말투는 매 턴(500자 상한), 정체·능력 상세는 물어봤을 때만.
// S4 는 그 규율을 **집 전체**로 넓힌다.
//
// ── 이름은 복제하지 않는다 ──────────────────────────────────────────────
// `AGENTS.md` 를 그대로 쓸 이유가 없다(계획 §5 비목표). 한국 사용자가 자기 컴퓨터에서 열어
// 고치는 파일이므로 **우리말 이름**을 쓴다: `지침.md` · `사용자.md`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentHomeDir, seedAgentHome, readHomeDocs, HOME_DOC_MAX, HOME_TOTAL_MAX } from '../src/surface/agent-home.js';

const 집만들기 = async () => mkdtemp(join(tmpdir(), 't5-home-'));

test('① 집은 **설정·상태와 다른 자리**다', () => {
  const env = { HOME: '/Users/someone' };
  const 집 = agentHomeDir(env);
  assert.ok(!집.includes('/.local/state/'),
    `집이 상태 디렉터리 안에 있다 — 사용자가 열어 볼 자리가 아니다: ${집}`);
  assert.ok(집.includes('GPAO-T5'), `집이 작업 폴더가 아니다: ${집}`);
});

test('② 처음이면 씨앗을 놓는다 — 그리고 **다시는 덮어쓰지 않는다**', async () => {
  const dir = await 집만들기();
  await seedAgentHome(dir);
  const 지침 = join(dir, '지침.md');
  const 처음 = await readFile(지침, 'utf8');
  assert.ok(처음.trim().length > 0, '씨앗이 비었다 — 사용자가 무엇을 고쳐야 할지 모른다');

  await writeFile(지침, '사용자가 고친 내용\n', 'utf8');
  await seedAgentHome(dir);
  assert.equal(await readFile(지침, 'utf8'), '사용자가 고친 내용\n',
    '사용자가 고친 것을 우리가 지웠다 — 집은 사용자의 것이다');
});

test('③ 읽어 온다 — 그리고 **예산을 건다**(불변식 B)', async () => {
  const dir = await 집만들기();
  await writeFile(join(dir, '지침.md'), 'ㄱ'.repeat(HOME_DOC_MAX + 5000), 'utf8');
  const docs = await readHomeDocs(dir);
  assert.ok(docs.지침.length <= HOME_DOC_MAX + 200,
    `상한을 안 걸었다(${docs.지침.length}자) — 매 세션 실리는 자리는 예산이 있어야 한다`);
  assert.match(docs.지침, /줄였|생략|잘렸/, '조용히 자르지 않는다 — 얼마나 뺐는지 말한다');
});

test('④ 여러 파일을 합쳐도 전체 상한을 넘지 않는다', async () => {
  const dir = await 집만들기();
  await writeFile(join(dir, '지침.md'), 'ㄱ'.repeat(HOME_DOC_MAX), 'utf8');
  await writeFile(join(dir, '사용자.md'), 'ㄴ'.repeat(HOME_DOC_MAX), 'utf8');
  const docs = await readHomeDocs(dir);
  const 합 = (docs.지침?.length ?? 0) + (docs.사용자?.length ?? 0);
  assert.ok(합 <= HOME_TOTAL_MAX + 400, `전체 상한을 안 걸었다(${합}자)`);
});

test('⑤ 없으면 없는 것으로 둔다 — 빈 파일을 지어내지 않는다', async () => {
  const dir = await 집만들기();
  const docs = await readHomeDocs(dir);
  assert.equal(docs.지침, undefined);
  assert.equal(docs.사용자, undefined);
});

test('⑥ 집이 아예 없어도 죽지 않는다(첫 실행·권한 없음)', async () => {
  const docs = await readHomeDocs(join(await 집만들기(), '없는자리'));
  assert.deepEqual(docs, {});
});

test('⑦ 씨앗은 **무엇을 적는 자리인지** 말한다(빈 종이를 주지 않는다)', async () => {
  const dir = await 집만들기();
  await seedAgentHome(dir);
  const 지침 = await readFile(join(dir, '지침.md'), 'utf8');
  const 사용자 = await readFile(join(dir, '사용자.md'), 'utf8');
  assert.match(지침, /고쳐|적어|바꾸/, '고쳐도 된다는 것을 안 알려 준다');
  assert.match(사용자, /고쳐|적어|부르/, '무엇을 적는 자리인지 안 알려 준다');
});

test('⑧ 하위 폴더를 만들지 않는다 — 사용자 작업 폴더를 어지럽히지 않는다', async () => {
  const dir = await 집만들기();
  await mkdir(join(dir, '내작업'), { recursive: true });
  await seedAgentHome(dir);
  const docs = await readHomeDocs(dir);
  assert.ok(docs.지침, '씨앗은 놓되');
  assert.equal((await readFile(join(dir, '지침.md'), 'utf8')).includes('내작업'), false,
    '사용자 폴더 내용을 씨앗에 섞지 않는다');
});

// **씨앗이 한 약속이 참인가**(2026-08-05 · 오너 라이브가 잡았다).
//
// 씨앗 `지침.md` 는 이렇게 말한다: *"여기 적은 것은 **다음 대화부터** T5 가 그대로 따른다."*
// 그런데 서버는 **시작할 때 한 번만** 읽고 있었다. 오너가 지침에 호칭을 적었는데 다음 대화에서
// 안 따랐다 — **우리가 거짓 약속을 한 것이다.**
//
// fixture 검사가 못 잡은 이유: 내가 편집할 때마다 서버를 다시 띄웠다.
// **재는 자리가 사용자의 실제 행동과 달랐다.** 그래서 여기서는 다시 안 띄우고 잰다.
test('⑨ **씨앗의 약속이 참이다** — 고치면 다시 안 띄워도 반영된다', async () => {
  const dir = await 집만들기();
  await seedAgentHome(dir);
  const 씨앗 = await readFile(join(dir, '지침.md'), 'utf8');
  assert.match(씨앗, /다음 대화부터/, '씨앗이 한 약속이 바뀌었다 — 검사도 함께 고쳐라');

  // 사용자가 파인더로 열어 고친다(서버를 다시 띄우지 않는다).
  await writeFile(join(dir, '지침.md'), '# 이렇게 일해 줘\n\n- 나를 윤님이라고 불러라.\n', 'utf8');
  const 다시읽음 = await readHomeDocs(dir);
  assert.match(다시읽음.지침 ?? '', /윤님/,
    '고친 것이 안 읽힌다 — 씨앗이 "다음 대화부터"라고 약속했는데 지키지 못한다');
});
