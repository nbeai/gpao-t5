// 자격 파일에는 **문이 하나**다 (2026-08-14).
//
// 밟은 것(2026-08-12): `~/.local/state/gpao-t5/sessions/model-connection.json` 을
// "provider·modelId 만 보려고" 열어서 찍었다. 가림막이 있었는데 **부모 키 이름으로 걸러**
// 정작 `key` 값이 그대로 세션 기록에 남았다 → **오너 키 회전**이 필요했다.
// 그 뒤로 규칙은 문장으로만 있었다(`scripts/agent-start.mjs` · `design/NEXT-SESSION.md`).
// **집행자가 0이었다.** 이 검사가 그 자리를 문다.
//
// 무는 것은 둘이다:
//   ① 인가된 통로(`scripts/model-connection-facts.mjs`)가 **키를 안 낸다** — 값으로 확인한다.
//      이름이 아니라 값으로 보는 것이 핵심이다. 이름으로 걸렀다가 밟은 사고가 위의 그것이다.
//   ② 그 통로 말고 **새로운 자리가 자격 파일을 읽기 시작하면** 빨개진다(기준선 대조).
//
// ⚠️ 이 검사는 **오너 자격 파일을 절대 열지 않는다.** 전부 임시 폴더의 가짜 고정물이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { 자격사실, 자격사실읽기, 샌것찾기, 상류만 } from '../scripts/model-connection-facts.mjs';

const 저장소 = dirname(dirname(fileURLToPath(import.meta.url)));

// ── 가짜 고정물 — 진짜 저장본 모양에 **적대적인 자리**를 몇 개 심는다 ──────────────
const 비밀들 = {
  키: 'sk-proj-FAKE-0123456789abcdefghijklmnop',
  갱신: 'refresh-FAKE-zyxwvutsrqponmlkjihgfedcba',
  접근: 'access-FAKE-abcdefghijklmnopqrstuvwxyz',
  // **부모 이름이 무해한 자리** — 2026-08-12 사고의 모양 그대로다
  무해한부모: 'sk-live-FAKE-hidden-under-innocent-parent',
  // **아직 존재하지 않는 이름** — 화이트리스트면 이름을 몰라도 안 나가야 한다
  미래이름: 'tok-FAKE-field-that-did-not-exist-yet',
};

function 고정물() {
  return {
    version: 2,
    activeId: 'openai:gpt-5.1',
    roleBindings: { default: 'openai:gpt-5.1' },
    connections: [
      {
        id: 'openai:gpt-5.1', kind: 'api_key', provider: 'openai', modelId: 'gpt-5.1',
        label: 'OpenAI · gpt-5.1', baseUrl: 'https://api.openai.com/v1', verified: true,
        key: 비밀들.키,
        credentialFp: 'd1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6',       // 키의 해시 조각 — 이것도 안 나간다
        instanceId: '11111111-2222-3333-4444-555555555555',
        credentialRef: '66666666-7777-8888-9999-000000000000',
        meta: { value: 비밀들.무해한부모 },                        // 무해한 부모 이름 아래 비밀
        futureSecretField: 비밀들.미래이름,                        // 내일 생길 이름
      },
      {
        id: 'chatgpt_oauth:gpt-5.1-codex', kind: 'chatgpt_oauth', provider: 'chatgpt_oauth',
        modelId: 'gpt-5.1-codex', label: 'ChatGPT 계정 · gpt-5.1-codex',
        credential: { access: 비밀들.접근, refresh: 비밀들.갱신, expiresAt: 1 },
      },
    ],
  };
}

async function 임시방(내용) {
  const 방 = await mkdtemp(join(tmpdir(), 't5-conn-door-'));
  const 자리 = join(방, 'model-connection.json');
  await writeFile(자리, 내용, 'utf8');
  return { 방, 자리 };
}

// ── ① 통로가 키를 안 낸다 ────────────────────────────────────────────────────
test('통로는 공급자·모델·상류를 주고 키·토큰은 한 조각도 안 준다', async () => {
  const { 방, 자리 } = await 임시방(JSON.stringify(고정물()));
  try {
    const r = await 자격사실읽기({ 자리 });
    const 글자 = JSON.stringify(r.사실); // 임시 경로의 무작위 글자가 섞이지 않게 사실만 본다

    // 필요한 사실은 실제로 나온다 — 필요를 안 없애야 사람이 파일을 안 연다
    assert.equal(r.있음, true);
    assert.equal(r.사실.연결수, 2);
    assert.equal(r.사실.기본연결, 'openai:gpt-5.1');
    assert.equal(r.사실.연결[0].provider, 'openai');
    assert.equal(r.사실.연결[0].modelId, 'gpt-5.1');
    assert.equal(r.사실.연결[0].상류, 'https://api.openai.com/v1');
    assert.equal(r.사실.연결[0].자격있음, true, '자격 유무는 알려줘야 한다(값 말고 한 비트)');
    assert.deepEqual(r.사실.연결[0].역할, ['default']);
    assert.equal(r.사실.연결[1].자격있음, true, 'OAuth 자격도 유무는 보여야 한다');

    // 비밀은 원문도, 조각도 안 나온다
    for (const [이름, 값] of Object.entries(비밀들)) {
      assert.ok(!글자.includes(값), `**${이름} 원문이 그대로 나갔다** — 2026-08-12 그 사고다`);
      assert.ok(!글자.includes(값.slice(0, 8)), `**${이름} 의 접두가 나갔다** — 접두는 키를 좁힌다`);
      assert.ok(!글자.includes(값.slice(-8)), `**${이름} 의 꼬리가 나갔다**`);
      assert.ok(!글자.includes(String(값.length)), `**${이름} 의 길이가 나갔다** — 길이도 키를 좁힌다`);
    }
    // 해시·불투명 신분도 안 나간다(해시는 사전대입으로 좁혀진다)
    assert.ok(!글자.includes('d1e2f3a4'), '**키의 해시 조각이 나갔다**');
    assert.ok(!글자.includes('11111111-2222'), 'instanceId 가 나갔다');
    // 나가는 **필드 이름**도 목록 그대로여야 한다 — 새 필드는 사람이 보고 올려야 한다
    for (const c of r.사실.연결) {
      const 남은이름 = Object.keys(c).filter((k) => !['kind', 'provider', 'modelId', 'id', 'label',
        'verified', '상류', '자격있음', '기본', '역할'].includes(k));
      assert.deepEqual(남은이름, [], `**목록 밖 필드가 나갔다**: ${남은이름.join(', ')}`);
    }
  } finally { await rm(방, { recursive: true, force: true }); }
});

test('넣는 목록이다 — 내일 생길 이름도 기본은 「안 나감」이다', () => {
  // 화이트리스트인지 확인하는 방법: **본 적 없는 이름**을 넣어 보고 안 나오는지 본다.
  // 빼는 목록이었다면 이 필드는 통과했을 것이다(그게 2026-08-12 의 실패 방식이다).
  const 저장본 = {
    version: 2, activeId: 'x:y',
    connections: [{
      id: 'x:y', provider: 'x', modelId: 'y',
      아직없던이름: 'sk-FAKE-tomorrow-000000000', ㅇㅇ: { 깊은: { 곳: 'sk-FAKE-deep-1111111111' } },
    }],
  };
  const 글자 = JSON.stringify(자격사실(저장본));
  assert.ok(!글자.includes('sk-FAKE-tomorrow'), '**새 이름의 값이 나갔다** — 빼는 목록으로 짰다는 뜻이다');
  assert.ok(!글자.includes('sk-FAKE-deep'), '**중첩된 값이 나갔다**');
  assert.equal(샌것찾기(저장본, 자격사실(저장본)).length, 0);
});

test('되짚어 보는 자가 있다 — 화이트리스트를 뚫어도 값으로 잡힌다', () => {
  const 저장본 = 고정물();
  // 통로가 실수로 키를 실었다고 가정하고, 되짚는 자가 그걸 잡는지 본다
  const 샌출력 = { ...자격사실(저장본), 실수로실은것: 비밀들.키 };
  const 샌자리 = 샌것찾기(저장본, 샌출력);
  assert.ok(샌자리.includes('connections.0.key'), `되짚는 자가 못 잡았다: ${JSON.stringify(샌자리)}`);
  assert.ok(!JSON.stringify(샌자리).includes(비밀들.키), '**샌 자리를 알리면서 값을 또 실었다**');
});

test('상류 주소에 자격이 실려 있으면 떼고 준다', () => {
  assert.equal(상류만('https://user:sk-FAKE-pw@gw.example.com/v1?key=sk-FAKE-q'), 'https://gw.example.com/v1');
  assert.equal(상류만('주소아님'), null, '못 읽는 주소는 원문을 대신 내보내면 안 된다');
  assert.equal(상류만(undefined), null);
});

// ── 없는 것은 없다고 말한다 ──────────────────────────────────────────────────
test('파일이 없으면 없다고 한다 — 지어내지 않는다', async () => {
  const 방 = await mkdtemp(join(tmpdir(), 't5-conn-none-'));
  try {
    const r = await 자격사실읽기({ 자리: join(방, 'model-connection.json') });
    assert.equal(r.있음, false);
    assert.equal(r.사실, null);
    assert.match(r.사유, /없다/);
  } finally { await rm(방, { recursive: true, force: true }); }
});

test('깨진 JSON 이어도 파일 내용이 오류 메시지로 새지 않는다', async () => {
  // Node 20+ 의 JSON 파싱 오류 메시지는 **입력 조각을 싣는다**. 그대로 찍으면 그게 사고다.
  const { 방, 자리 } = await 임시방(`{"connections":[{"key":"${비밀들.키}"`);
  try {
    const r = await 자격사실읽기({ 자리 });
    const 글자 = JSON.stringify(r);
    assert.equal(r.사실, null);
    assert.ok(!글자.includes(비밀들.키), `**깨진 파일의 키가 오류 메시지로 나갔다**: ${r.사유}`);
    assert.ok(!글자.includes('sk-proj'), '**키 접두가 오류 메시지로 나갔다**');
  } finally { await rm(방, { recursive: true, force: true }); }
});

// ── ② 문이 하나인가 — 자격 파일을 아는 자리의 기준선 ─────────────────────────
//
// 기준선은 **전수로 찾아 세웠다**(2026-08-14). 여기 없는 자리가 자격 파일 이름을 알게 되면
// 이 검사가 빨개진다. 새로 쓰는 손은 두 갈래 중 하나로 간다 —
//   · 사실만 필요하다  → `scripts/model-connection-facts.mjs` 를 쓴다(파일을 안 연다)
//   · 진짜로 자격이 필요하다(모델에 붙어야 한다) → 여기에 **이유와 함께** 올린다
//
// ⚠️ 한계(정직하게 적는다): 이 검사는 **자격 파일 이름을 아는 파일**을 센다.
//    이미 목록에 있는 파일이 읽는 자리를 하나 더 늘리는 것은 못 잡는다. 잡는 것은
//    「**새로운 자리**가 자격 파일을 알게 되는 것」 — 2026-08-12 이 실제로 그 모양이었다.
const 자격파일이름 = 'model-connection.json';
const 아는자리 = new Map([
  ['scripts/model-connection-facts.mjs', '인가된 통로 — 키가 아닌 사실만 내준다(이 검사가 무는 그 문)'],
  ['test/credential-file-single-door.test.js', '이 검사 자신'],
  ['src/surface/model-connection.js', '제품의 자격 저장소 — 모델에 붙으려면 키가 필요하다(0600 으로 쓴다)'],
  ['scripts/s1/run.mjs', '라이브 계측기 `저장된연결()` — 오너 연결로 실제 호출을 한다(값은 안 찍는다)'],
  ['scripts/live/h04-memory-round.mjs', '라이브 회차 — 저장된 연결로 모델을 붙인다'],
  ['scripts/live/p-op-false-premise-probe.mjs', '라이브 회차 — 저장된 연결로 모델을 붙인다'],
  ['scripts/live/p-op-defect-family-reproduce.mjs', '라이브 회차 — 저장된 연결로 모델을 붙인다'],
  ['scripts/live/organ-round.mjs', '라이브 회차 — 격리 방으로 연결을 복사한다(오너 자리는 읽기만)'],
  ['scripts/live/automation-close.mjs', '라이브 회차 — 격리 방으로 연결을 복사한다(오너 자리는 읽기만)'],
  ['scripts/live/asset-scorecard.mjs', '라이브 회차 — 격리 방으로 연결을 복사한다(오너 자리는 읽기만)'],
  ['scripts/production90/p90-1-live-reseal.mjs', 'P90 재봉인 — 격리 자리에 심볼릭 링크만 건다(사본을 안 만든다)'],
  ['test/living-sim-runner.test.js', '검사 고정물 — 임시 홈에 가짜 연결을 쓴다'],
  ['scripts/agent-start.mjs', '착수 브리핑 — "열지 마라"고 말만 한다(읽지 않는다)'],
]);

async function 훑기(뿌리) {
  const 나온것 = [];
  const 볼확장자 = new Set(['.mjs', '.js', '.cjs', '.ts', '.json', '.sh', '.py']);
  const 걸어가기 = async (자리) => {
    for (const e of await readdir(자리, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = join(자리, e.name);
      if (e.isDirectory()) { await 걸어가기(p); continue; }
      if (!볼확장자.has(extname(e.name))) continue;
      const 글 = await readFile(p, 'utf8').catch(() => '');
      if (글.includes(자격파일이름)) 나온것.push(relative(저장소, p));
    }
  };
  await 걸어가기(join(저장소, 뿌리));
  return 나온것;
}

test('자격 파일을 아는 자리는 기준선 그대로다 — 새 자리가 생기면 여기서 빨개진다', async () => {
  const 찾은것 = (await Promise.all(['scripts', 'src', 'test'].map(훑기))).flat().sort();
  const 새자리 = 찾은것.filter((p) => !아는자리.has(p));
  assert.deepEqual(새자리, [],
    `**인가되지 않은 자리가 자격 파일을 읽으려 한다**:\n  ${새자리.join('\n  ')}\n`
    + '  사실만 필요하면 `scripts/model-connection-facts.mjs` 를 쓴다(파일을 안 연다).\n'
    + '  진짜로 자격이 필요하면 이 검사의 `아는자리` 에 **이유와 함께** 올린다.');
  const 사라진자리 = [...아는자리.keys()].filter((p) => !찾은것.includes(p)).sort();
  assert.deepEqual(사라진자리, [],
    `기준선에 **없어진 자리**가 남아 있다(목록에서 지워라):\n  ${사라진자리.join('\n  ')}`);
});
