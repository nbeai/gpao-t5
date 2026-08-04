// **S0 계측 — 모델이 실제로 무엇을 받는지 본다.**
//
// 왜 이게 첫 단계인가(2026-08-05):
//   오너 라이브에서 "안녕" 한 마디에 T5 가 능력 목록을 읊었다. 나는 원인을 **세 번** 잘못 짚었다.
//     ① `CAPABILITIES.md` 를 통째로 싣는 줄 알았다 → 아니었다(이미 물어봤을 때만 싣는다).
//     ② `buildCapabilityFacts` 의 `blocked` 라고 확정했다 → `fast_chat` 은 limits 를 비운다.
//     ③ 계획서에 "파일은 한 폴더만 본다"를 적었다 → 제품 기본 뿌리는 넷이었다.
//   셋 다 **조립된 프롬프트를 못 봤기 때문**이다. 눈이 없으면 소스를 읽어도 확신만 는다.
//
// 계약 넷:
//   ① 기본은 꺼짐이다 — 계측이 제품 기본 동작을 바꾸지 않는다.
//   ② 켜면 모델에 들어간 것이 그대로 남는다(system·user·도구 이름).
//   ③ **켜도 모델에 가는 것이 달라지지 않는다** — 관측이 대상을 바꾸지 않는다(불변식 A).
//   ④ 비밀은 원문으로 남지 않는다. 덤프는 디스크에 남는 파일이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildModelMessages } from '../src/runtime/model-provider.js';
import { dumpModelInput, promptDumpDir } from '../src/runtime/prompt-dump.js';

/** 최소 TaskContextPacket — 조립기가 요구하는 모양만. */
const 패킷 = (over = {}) => ({
  currentRequest: '안녕',
  identity: { name: 'GPAO-T5' },
  selfStateFacts: { model: { id: 'gpt-5.1' }, readyTools: ['웹 자료 수집', '로컬 파일'], limits: [] },
  capabilityCounts: { ready: 2, needsApproval: 1, blocked: 3 },
  ...over,
});

test('① 기본은 꺼짐 — 환경이 없으면 아무것도 안 쓴다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-s0-off-'));
  assert.equal(promptDumpDir({}), null, '환경이 없는데 덤프 자리를 만들었다');
  const 적힘 = await dumpModelInput({ messages: buildModelMessages(패킷()), tools: [] }, {});
  assert.equal(적힘, null, '꺼져 있는데 무언가를 썼다');
  assert.deepEqual(await readdir(dir), [], '꺼져 있는데 파일이 생겼다');
});

test('② 켜면 모델이 받은 것이 그대로 남는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-s0-on-'));
  const env = { GPAO_T5_PROMPT_DUMP: dir };
  const messages = buildModelMessages(패킷());
  const 적힘 = await dumpModelInput(
    { messages, tools: [{ name: 'local.file' }, { name: 'web.collect' }], meta: { turn: 1 } },
    env,
  );
  assert.ok(적힘, '켰는데 아무것도 안 썼다');
  const 저장 = JSON.parse(await readFile(적힘, 'utf8'));
  assert.equal(저장.user, '안녕');
  assert.ok(저장.system.includes('GPAO-T5'), `정체성 줄이 안 남았다: ${저장.system.slice(0, 200)}`);
  assert.deepEqual(저장.toolNames, ['local.file', 'web.collect'], '도구 목록이 안 남았다');
  // 크기를 남긴다 — 불변식 B(좁은 허리)를 단계마다 수치로 대조하려면 이게 있어야 한다.
  assert.equal(typeof 저장.systemChars, 'number');
  assert.ok(저장.systemChars > 0);
});

test('③ **켜도 모델에 가는 것은 그대로다** — 관측이 대상을 바꾸지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-s0-same-'));
  const 끈것 = buildModelMessages(패킷());
  await dumpModelInput({ messages: 끈것, tools: [] }, {});
  const 켠것 = buildModelMessages(패킷());
  await dumpModelInput({ messages: 켠것, tools: [] }, { GPAO_T5_PROMPT_DUMP: dir });
  assert.deepEqual(켠것, 끈것, '덤프를 켰더니 모델에 가는 메시지가 달라졌다(불변식 A 위반)');
});

// **불변식 A 를 재는 자리**(검토 지적 2026-08-05).
// T5 는 대화 중에 도구 집합이 실제로 바뀐다 — 사용자가 "노션 붙여줘" 하면 `admitHttpTools` 가
// 그 자리에서 새 손을 들인다(`connector-connect.js:182`·`:310`). 자동성 헌장상 그건 옳다
// (붙이고 새 대화를 열게 하면 마찰을 늘려 절약을 사는 꼴이다).
// 그래서 불변식 A 의 두 번째 예외가 필요하고, 그 예외에는 규칙이 붙는다 — **뒤에만 붙인다.**
//
// 캐시 **적중**은 공급자 거동이라 우리가 통제하지 못한다. 우리가 통제하는 것은
// **접두가 안 바뀌는가**다. 그것만 잰다.
test('⑤ 손이 뒤에 붙으면 앞 도구들의 접두 지문이 그대로다(append-only)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-s0-append-'));
  const env = { GPAO_T5_PROMPT_DUMP: dir };
  const 앞 = [{ name: 'local.file' }, { name: 'web.collect' }];
  const 뒤에붙임 = [...앞, { name: 'notion.pages' }];

  const 읽기 = async (p) => JSON.parse(await readFile(p, 'utf8'));
  const a = await 읽기(await dumpModelInput({ messages: buildModelMessages(패킷()), tools: 앞 }, env));
  const b = await 읽기(await dumpModelInput({ messages: buildModelMessages(패킷()), tools: 뒤에붙임 }, env));

  assert.deepEqual(b.toolPrefixSha.slice(0, 앞.length), a.toolPrefixSha,
    '뒤에만 붙였는데 앞 도구들의 접두 지문이 바뀌었다 — 캐시 접두가 죽는다');
  assert.equal(b.toolPrefixSha.length, 뒤에붙임.length);
});

test('⑥ 중간에 끼워 넣거나 순서를 바꾸면 접두가 죽는 것이 **보인다**', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-s0-reorder-'));
  const env = { GPAO_T5_PROMPT_DUMP: dir };
  const 읽기 = async (p) => JSON.parse(await readFile(p, 'utf8'));
  const a = await 읽기(await dumpModelInput(
    { messages: buildModelMessages(패킷()), tools: [{ name: 'local.file' }, { name: 'web.collect' }] }, env,
  ));
  const b = await 읽기(await dumpModelInput(
    { messages: buildModelMessages(패킷()), tools: [{ name: 'notion.pages' }, { name: 'local.file' }, { name: 'web.collect' }] }, env,
  ));
  // 계측기가 실제로 무는지 확인한다 — 안 물면 append-only 검사도 의미가 없다.
  assert.notEqual(b.toolPrefixSha[0], a.toolPrefixSha[0],
    '앞에 끼워 넣었는데 접두 지문이 같다고 나온다 — 계측기가 안 문다');
});

test('⑦ 안정 접두(systemStable)가 남는다 — 무엇이 캐시 대상인지 보인다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-s0-stable-'));
  const 적힘 = await dumpModelInput(
    { messages: buildModelMessages(패킷()), tools: [] }, { GPAO_T5_PROMPT_DUMP: dir },
  );
  const 저장 = JSON.parse(await readFile(적힘, 'utf8'));
  assert.equal(typeof 저장.systemStableChars, 'number', '안정 접두 크기가 안 남았다');
  assert.ok(저장.systemStableChars > 0);
  assert.ok(저장.systemStableChars <= 저장.systemChars, '안정 접두가 전체보다 클 수 없다');
});

test('④ 비밀은 원문으로 디스크에 남지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-s0-secret-'));
  const 비밀 = 'sk-live-4bd9f1c2e7a84c0fb3d6e9a1c5f70b28';
  const 적힘 = await dumpModelInput(
    { messages: buildModelMessages(패킷({ currentRequest: `이 키 써줘: ${비밀}` })), tools: [] },
    { GPAO_T5_PROMPT_DUMP: dir },
  );
  const 본문 = await readFile(적힘, 'utf8');
  assert.equal(본문.includes(비밀), false, '비밀이 원문으로 디스크에 남았다');
  assert.match(본문, /\*{3,}|가림|masked/, '가렸다는 표시가 없다 — 지운 자국은 남아야 한다');
});
