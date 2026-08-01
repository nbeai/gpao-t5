// 실제 저장 모델 연결 + 격리 파일 폴더로 H08 제품 경로를 한 번 관통한다.
// 비밀값·실사용자 파일·실사용자 세션은 읽거나 출력하지 않는다.
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { EventLog } from '../src/surface/event-log.js';
import { MemoryStore } from '../src/surface/memory-store.js';
import { ModelConnectionStore, makeModelConnection } from '../src/surface/model-connection.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { makeLocalLocateTool } from '../src/runtime/local-locate.js';

const digest = async (path) => createHash('sha256').update(await readFile(path)).digest('hex');
const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-pc-hands-live-'));
const sessions = join(dir, 'sessions');
const files = join(dir, 'Downloads');
const oldFile = join(files, '견적서-최종.md');
const newFile = join(files, '견적서-v3.md');
await mkdir(files, { recursive: true });
await writeFile(oldFile, '상품 1000원\n배송비 별도', 'utf8');
await writeFile(newFile, '상품 1000원\n배송비 200원 포함\n총액 1200원', 'utf8');
const now = new Date();
await utimes(oldFile, new Date(now.getTime() - 3_600_000), new Date(now.getTime() - 3_600_000));
await utimes(newFile, now, now);
const before = new Map([[oldFile, await digest(oldFile)], [newFile, await digest(newFile)]]);

const env = demoEnv();
const connection = makeModelConnection({ env, processEnv: process.env, store: new ModelConnectionStore() });
await connection.init();
const publicState = connection.list();
if (!publicState.activeId && !publicState.envFallback) throw new Error('실제 모델 연결이 없어 라이브 검증을 시작할 수 없다');

const store = new SessionStore(sessions);
const contractJudgments = [];
let requiredToolRequests = 0;
const measuredModel = {
  async respond(tc, opts) {
    if (opts?.requiredTool === 'local.file') requiredToolRequests += 1;
    const out = await connection.model.respond(tc, opts);
    if (tc?.workContractAssessment) contractJudgments.push(typeof out === 'string' ? out : out?.text);
    return out;
  },
};
const server = makeServer({
  store, eventLog: new EventLog(sessions), memStore: new MemoryStore(sessions), env,
  model: measuredModel, modelConnection: connection,
  modelProviderId: () => connection.providerId(),
  tools: demoTools({
    localFile: makeLocalFileTool({ roots: [files], dataDir: sessions, homeDir: dir }),
    localLocate: makeLocalLocateTool({ home: dir, volumesDir: join(dir, 'Volumes') }),
  }),
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const post = async (path, body = {}) => fetch(`${base}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}).then((r) => r.json());

try {
  const session = await post('/sessions');
  let result = await post('/turn', {
    sessionId: session.id,
    text: '내 다운로드 폴더(~/Downloads)의 견적서들 중 이름만 믿지 말고 수정 시각과 내용을 근거로 실제 최종본을 골라. 원본은 건드리지 말고 같은 폴더에 별도 정리본 파일을 만들어줘.',
  });
  let approvals = 0;
  while (result.kind === 'approval' && approvals < 3) {
    approvals += 1;
    result = await post('/turn', { sessionId: session.id, approve: result.pendingId });
  }
  const items = await readdir(files);
  const created = items.filter((name) => !['견적서-최종.md', '견적서-v3.md'].includes(name));
  const saved = await store.load(session.id);
  const writeReceipts = (saved.ledgerEntries ?? []).filter((receipt) =>
    receipt.actualCall?.tool === 'local.file'
    && receipt.actualCall?.args?.action === 'write'
    && receipt.failureState === 'none'
    && typeof receipt.result?.digest === 'string');
  const createdHasLatestContent = created.length === 1
    && /배송비 200원 포함|총액 1200원/.test(await readFile(join(files, created[0]), 'utf8'));
  const writeUsesLatestSource = writeReceipts.some((receipt) =>
    String(receipt.actualCall?.args?.source ?? '').endsWith('견적서-v3.md'));
  const originalsUnchanged = (await Promise.all([...before].map(async ([path, hash]) => (await digest(path)) === hash))).every(Boolean);
  const report = {
    model: publicState.connections.find((c) => c.active)?.modelId ?? publicState.envFallback?.modelId,
    provider: publicState.connections.find((c) => c.active)?.provider ?? publicState.envFallback?.provider,
    resultKind: result.kind,
    approvals,
    createdCount: created.length,
    writeReceiptCount: writeReceipts.length,
    requiredToolRequests,
    contractJudgments,
    actions: (saved.ledgerEntries ?? []).map((receipt) => ({
      tool: receipt.actualCall?.tool ?? null,
      action: receipt.actualCall?.args?.action ?? null,
      failureState: receipt.failureState,
      blocked: receipt.result?.blocked === true,
    })),
    reply: String(result.reply ?? '').slice(0, 500),
    originalsUnchanged,
    createdHasLatestContent,
    writeUsesLatestSource,
    passed: result.kind === 'reply' && created.length === 1 && writeReceipts.length === 1
      && originalsUnchanged && createdHasLatestContent && writeUsesLatestSource,
  };
  console.log(JSON.stringify(report));
  if (!report.passed) process.exitCode = 1;
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
}
