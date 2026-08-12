// **캡슐이 모델의 손으로 선다** — 격리만 있고 못 쓰면 의미가 없다.
//
// 이 검사가 재는 것은 격리가 아니라(그건 `s4-capsule-isolation.test.js`) **쓸모**다:
//   · 모델이 스키마에서 캡슐을 본다
//   · 읽기 결과가 다음 조건이 되는 일을 **왕복 하나**에 끝낸다 (S4 가 사는 이유)
//   · 중간 결과가 모델 입력에 안 들어간다
//   · 캡슐 안 실행이 원장·영수증으로 그대로 온다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools, demoDescriptors } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { makeCapsuleTool } from '../src/runtime/capsule.js';
import { modelSchemasFor } from '../src/kernel/l2-plan/model-control.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';

/** 각 CSV 의 합계가 100만을 넘는지는 **읽어 봐야 안다** — `match` 로 표현되지 않는 일. */
async function 정산무대() {
  const dir = await mkdtemp(join(tmpdir(), 's4-hand-'));
  await mkdir(join(dir, '큰건'), { recursive: true });
  const 표 = [
    ['가.csv', '항목,금액\n임대료,2000000\n'],
    ['나.csv', '항목,금액\n간식,3000\n'],
    ['다.csv', '항목,금액\n장비,5000000\n'],
    ['라.csv', '항목,금액\n커피,4500\n'],
  ];
  for (const [이름, 내용] of 표) await writeFile(join(dir, 이름), 내용);
  return { dir, localFile: makeLocalFileTool({ roots: [dir], dataDir: dir }) };
}

test('모델이 스키마에서 캡슐을 본다', async () => {
  const { dir, localFile } = await 정산무대();
  const tools = demoTools({ localFile, capsule: makeCapsuleTool({ cwd: dir }) });
  const selfState = buildSelfState(
    demoEnv({ include: ['local.file', 'local.capsule'], hands: ['local.file', 'local.capsule'] }),
    { tools: tools.tools, descriptors: demoDescriptors({ include: ['local.file', 'local.capsule'] }) },
  );
  const 이름들 = modelSchemasFor(selfState).map((t) => t.name);
  assert.ok(이름들.includes('local.capsule'), `캡슐이 모델에게 안 보인다: ${이름들.join(', ')}`);
});

test('읽기 결과가 다음 조건이 되는 일을 **왕복 하나**에 끝낸다', async () => {
  const { dir, localFile } = await 정산무대();
  const capsule = makeCapsuleTool({ cwd: dir });
  let 왕복 = 0;
  let 냈나 = false;
  const model = {
    async respond(tc, opts = {}) {
      왕복 += 1;
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (opts.tools?.length && !냈나) {
        냈나 = true;
        return { text: '', toolCalls: [{
          providerCallId: 'call_CAPSULE', name: 'local.capsule',
          args: {
            code: `
              const 목록 = await t5.call('local.file', { action: 'list', path: '.' });
              const 옮긴것 = [];
              for (const it of (목록.result?.items ?? [])) {
                if (it.kind !== 'file' || !it.name.endsWith('.csv')) continue;
                const 읽음 = await t5.call('local.file', { action: 'read', path: it.name });
                const 합 = String(읽음.result?.text ?? '').split('\\n').slice(1)
                  .map((l) => Number(l.split(',')[1] || 0)).reduce((a, b) => a + b, 0);
                if (합 > 1000000) {
                  await t5.call('local.file', { action: 'move', path: it.name, to: '큰건/' + it.name });
                  옮긴것.push(it.name);
                }
              }
              console.log(JSON.stringify({ 옮긴것 }));
            `,
          },
        }] };
      }
      return '큰 건만 옮겼어요.';
    },
  };
  const r = await runTurn({ text: '정산표 중에 합계 100만 넘는 것만 큰건 폴더로 옮겨줘' }, {
    env: demoEnv({ include: ['local.file', 'local.capsule'], hands: ['local.file', 'local.capsule'] }),
    tools: demoTools({ localFile, capsule }),
    descriptors: demoDescriptors({ include: ['local.file', 'local.capsule'] }),
    model,
  });
  assert.equal(r.kind, 'reply');
  // **실물이 계약이다** — 합계가 넘는 둘만 옮겨졌는가.
  assert.ok(existsSync(join(dir, '큰건', '가.csv')), '2,000,000 짜리가 안 옮겨졌다');
  assert.ok(existsSync(join(dir, '큰건', '다.csv')), '5,000,000 짜리가 안 옮겨졌다');
  assert.ok(existsSync(join(dir, '나.csv')), '3,000 짜리가 잘못 옮겨졌다');
  assert.ok(existsSync(join(dir, '라.csv')), '4,500 짜리가 잘못 옮겨졌다');
  // **왕복 하나.** 이게 S4 가 사는 이유다 — 지금 도구로는 파일마다 왕복이 든다.
  assert.ok(왕복 <= 4, `읽기 4·이동 2 를 하는데 모델을 ${왕복}번 불렀다 — 캡슐의 뜻이 없다`);
});

test('중간 결과는 모델 입력에 안 들어간다(결과만 온다)', async () => {
  const { dir, localFile } = await 정산무대();
  const capsule = makeCapsuleTool({ cwd: dir });
  const 본것 = [];
  let 냈나 = false;
  const model = {
    async respond(tc, opts = {}) {
      본것.push(tc);
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (opts.tools?.length && !냈나) {
        냈나 = true;
        return { text: '', toolCalls: [{ name: 'local.capsule', args: { code: `
          const 목록 = await t5.call('local.file', { action: 'list', path: '.' });
          let 합 = 0;
          for (const it of (목록.result?.items ?? [])) {
            if (!it.name.endsWith('.csv')) continue;
            const 읽음 = await t5.call('local.file', { action: 'read', path: it.name });
            합 += String(읽음.result?.text ?? '').length;
          }
          console.log('총 글자수: ' + 합);
        ` } }] };
      }
      return '세어 봤어요.';
    },
  };
  await runTurn({ text: '정산표 글자수 다 세줘' }, {
    env: demoEnv({ include: ['local.file', 'local.capsule'], hands: ['local.file', 'local.capsule'] }),
    tools: demoTools({ localFile, capsule }),
    descriptors: demoDescriptors({ include: ['local.file', 'local.capsule'] }),
    model,
  });
  const 전문 = JSON.stringify(본것);
  assert.match(전문, /총 글자수/, '캡슐이 낸 결과가 모델에게 안 갔다');
  assert.doesNotMatch(전문, /임대료,2000000/,
    '중간에 읽은 파일 본문이 모델 입력에 들어갔다 — 캡슐의 뜻이 없다');
});

test('캡슐 안 실행이 **원장에 그대로** 남는다', async () => {
  const { dir, localFile } = await 정산무대();
  const capsule = makeCapsuleTool({ cwd: dir });
  const 원장 = [];
  let 냈나 = false;
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (opts.tools?.length && !냈나) {
        냈나 = true;
        return { text: '', toolCalls: [{ name: 'local.capsule', args: { code: `
          await t5.call('local.file', { action: 'read', path: '가.csv' });
          await t5.call('local.file', { action: 'read', path: '나.csv' });
        ` } }] };
      }
      return '읽었어요.';
    },
  };
  await runTurn({ text: '두 개 읽어줘' }, {
    env: demoEnv({ include: ['local.file', 'local.capsule'], hands: ['local.file', 'local.capsule'] }),
    tools: demoTools({ localFile, capsule }),
    descriptors: demoDescriptors({ include: ['local.file', 'local.capsule'] }),
    model,
    ledger: { entries: 원장, append: (x) => 원장.push(x) },
  });
  const 파일읽기 = 원장.filter((e) => e.actualCall?.tool === 'local.file');
  assert.ok(파일읽기.length >= 2,
    `캡슐 안 실행이 원장에 안 남았다(${파일읽기.length}건) — 사용자도 감사도 무슨 일이 있었는지 모른다`);
});
