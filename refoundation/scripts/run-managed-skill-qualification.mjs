#!/usr/bin/env node
import { mkdir, mkdtemp, rm } from 'node:fs/promises'; import { homedir, tmpdir } from 'node:os'; import { join, resolve } from 'node:path';
import { makeConsoleModelAccess } from '../src/console-model-factory.js'; import { makeConsoleServer } from '../src/console-server.js';
const room = await mkdtemp(join(tmpdir(), 't5-r9-managed-skill-')); const workspace = join(room, 'workspace'); await mkdir(workspace);
const access = makeConsoleModelAccess({ connectionFile: resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE ?? join(homedir(), '.local/state/gpao-t5/sessions/model-connection.json')), stateDir: join(room, 'model') });
const status = await access.status(); if (!status.connected) throw new Error('actual model required');
const server = makeConsoleServer({ stateDir: join(room, 'state'), workspace, modelFactory: (ctx) => access.model(ctx), modelStatus: () => access.status() });
await new Promise((r, j) => { server.once('error', j); server.listen(0, '127.0.0.1', r); }); const base = `http://127.0.0.1:${server.address().port}`;
const post = async (path, body = {}) => { const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const json = await response.json(); if (!response.ok) throw new Error(json.error); return json; };
async function receipts(sessionId) { const runs = await server.runLedger.list({ sessionId }); const details = await Promise.all(runs.map((r) => server.runLedger.read(r.runId)));
  return details.flatMap((r) => r.events).flatMap((e) => e.type === 'tool_completed' ? [e.payload.receipt] : []); }
try {
  const first = await post('/sessions'); const firstResult = await post('/turn', { sessionId: first.id, text: '앞으로 반복해서 쓸 검증된 고객 문의 정리 방법이 준비되어 있다면 찾아서 준비한 뒤 적용해줘. 사실: 영업시간은 10시~18시, 미개봉 상품은 7일 내 환불 가능, 현재 재고는 확인 전이야. 문의는 ① 몇 시까지 해요? ② 오늘 재고 있나요? ③ 어제 산 미개봉 상품 환불되나요?' });
  const firstReceipts = await receipts(first.id);
  const second = await post('/sessions'); const secondResult = await post('/turn', { sessionId: second.id, text: '준비된 고객 문의 정리 방법으로 분류해줘. 사실: 배송은 보통 2일, 오늘 출고 가능 여부는 확인 전. 문의는 ① 배송 며칠 걸려요? ② 오늘 바로 출고돼요?' });
  const secondReceipts = await receipts(second.id);
  const evidence = { schema: 't5.r9-managed-skill-live.v1', model: { provider: status.provider, modelId: status.modelId },
    checks: { installedOnce: firstReceipts.filter((r) => r.actualCall?.name === 'capability_prepare' && r.actualCall?.args?.action === 'install').length === 1,
      appliedFirst: /바로 답변|직접 확인/u.test(firstResult.reply), reusedWithoutInstall: secondReceipts.every((r) => !(r.actualCall?.name === 'capability_prepare' && r.actualCall?.args?.action === 'install')),
      installedSkillRead: secondReceipts.some((r) => r.actualCall?.name === 'skill'), appliedSecond: /2일|확인/u.test(secondResult.reply) },
    firstTools: firstReceipts.map((r) => `${r.actualCall?.name}:${r.actualCall?.args?.action ?? ''}`), secondTools: secondReceipts.map((r) => `${r.actualCall?.name}:${r.actualCall?.args?.action ?? ''}`),
    firstReply: firstResult.reply, secondReply: secondResult.reply };
  evidence.passed = Object.values(evidence.checks).every(Boolean); process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`); if (!evidence.passed) process.exitCode = 1;
} finally { server.closeWakeStreams(); await server.closeMessengers(); await server.closeWorkspaceConnections(); await new Promise((r) => server.close(r)); await rm(room, { recursive: true, force: true }); }
