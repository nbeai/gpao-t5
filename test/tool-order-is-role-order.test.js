// **배치는 선언에서 하고, 런타임은 다시 줄 세우지 않는다.**
//
// 비교군 실측(오픈클로 `src/agents/system-prompt.ts:822`, 2026-08-05):
// `toolOrder` 고정 순서를 두고 `toolOrder.filter((t) => visibleTools.has(t))` 로 거른다.
// **모델에게 "이 순서로 써라"라고 시키지 않는다 — 그냥 그 순서로 놓는다.**
// §1.2 가 말한 그것이다: 커널은 정하지도 지시하지도 않고 **배치**한다.
//
// T5 에는 이게 없었고, 순서는 `DESCRIPTORS` 배열에 적힌 순서 — **의도가 아니라 우연**이었다.
// 우연의 증거: `web.collect`(읽는다)가 `web.search`(찾는다)보다 **앞에** 있었다.
// 손을 나중에 나눠서 뒤에 붙었을 뿐이고, 아무도 그러기로 정하지 않았다.
//
// ── **역할로 줄 세우는 판은 만들었다가 되돌렸다** ────────────────────────────
//
// 처음엔 선언된 역할(`toolKind`)로 띠를 만들어 런타임에서 정렬했다.
// 이름 목록은 리팩터링에 죽으니(§4.4) 계약으로 묶는 것이 맞아 보였고, 검사도 초록이었다.
// **그런데 불변식 A 검사가 물었다** — *"능력이 늘면 뒤에 붙는다: 접두가 산다."*
//
// 역할 정렬은 새 손을 **자기 띠 한가운데 끼워 넣는다.** `read` 손이 하나 붙으면 그 뒤의
// 정리·실행·전송 손이 전부 밀리고, **그 순간 프롬프트 접두가 죽어 캐시가 함께 깨진다.**
//
//     불변식 A(캐시 접두)   값이 측정돼 있다 — 비용과 지연에 바로 닿는다
//     역할 정렬             값이 측정 안 됐다 — 비교군이 그렇게 한다는 것뿐이다
//
// **비교군이 한다는 것은 존재 근거이지 효과 근거가 아니다.** 측정된 계약을 안 측정된 기대와
// 바꾸지 않는다. 그래서 정렬은 걷고, **선언 순서를 사람이 바로잡는** 쪽만 남겼다.
// 이 파일이 재는 것은 그 둘이다: 배치가 실제로 섰는가 · 접두가 여전히 사는가.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolSchemasFor } from '../src/kernel/l2-plan/tool-schema.js';
import { demoContext, demoEnv } from '../src/surface/demo-context.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';

const 이름들 = (env) => toolSchemasFor(buildSelfState(env)).map((t) => t.name);

test('찾는 손이 읽는 손보다 앞에 온다 — 찾고 나서 읽는다', () => {
  const 이름 = toolSchemasFor(buildSelfState(demoContext({}).env)).map((t) => t.name);
  const 찾기 = 이름.indexOf('web.search');
  const 읽기 = 이름.indexOf('web.collect');
  assert.ok(찾기 >= 0 && 읽기 >= 0, '두 손이 다 실려야 한다');
  assert.ok(찾기 < 읽기,
    `배치가 거꾸로다 — 찾기 ${찾기}위, 읽기 ${읽기}위.\n`
    + '순서를 코드가 다시 세우지 않으므로 이건 `DESCRIPTORS` 선언 순서로 지킨다.');
});

test('런타임은 다시 줄 세우지 않는다 — 선언 순서가 그대로 나간다', () => {
  const 손 = (id, toolKind) => ({ id, toolKind, executable: true, schema: { description: id, parameters: {} } });
  // 역할이 뒤죽박죽이어도 손대지 않는다. 정렬하면 아래 접두 검사가 깨진다.
  const 준것 = [손('보내기', 'send'), 손('읽기', 'read'), 손('정리', 'organize')];
  assert.deepEqual(toolSchemasFor({ connectedTools: 준것 }).map((t) => t.name),
    ['보내기', '읽기', '정리'],
    '커널이 순서를 다시 정했다 — 새 손이 중간에 끼면 프롬프트 접두가 죽는다(불변식 A)');
});

test('능력이 늘면 뒤에 붙는다 — 접두가 산다(불변식 A)', () => {
  // 위 검사와 **같은 계약의 다른 면**이다. 정렬을 되살리면 여기서도 걸린다.
  const 적게 = demoEnv({ include: ['local.file', 'web.collect'], hands: ['local.file', 'web.collect'] });
  const 많게 = demoEnv({
    include: ['local.file', 'web.collect', 'session.search'],
    hands: ['local.file', 'web.collect', 'session.search'],
  });
  const a = 이름들(적게); const b = 이름들(많게);
  assert.ok(b.length > a.length, `손이 안 늘었다(${a.length}→${b.length})`);
  assert.deepEqual(b.slice(0, a.length), a, '늘어난 손이 앞을 밀어냈다 — 중간 삽입은 접두를 죽인다');
});

// ── 배치가 제한이 아니라는 증거 ──────────────────────────────────────────
// **틀려도 길이 막히지 않으면 배치이고 심문이 아니다**(원리 §1.2).
test('배치는 손을 늘리거나 줄이지 않는다 — 그랬으면 제한이다', () => {
  const env = demoContext({}).env;
  const self = buildSelfState(env);
  const 실린것 = new Set(toolSchemasFor(self).map((t) => t.name));
  const 실행가능 = new Set(self.connectedTools.filter((t) => t.executable && t.schema).map((t) => t.id));
  assert.deepEqual(실린것, 실행가능,
    '배치가 손 집합을 바꿨다 — 순서를 정하는 일이 능력을 정하는 일이 되면 그건 심문이다');
});
