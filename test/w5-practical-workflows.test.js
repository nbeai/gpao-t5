import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { ToolRunner } from '../src/runtime/tool-runner.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { makeWebCollector } from '../src/runtime/web-collector.js';
import { AutomationJobStore } from '../src/surface/automation-store.js';
import { EventLog } from '../src/surface/event-log.js';
import { MemoryStore } from '../src/surface/memory-store.js';
import { SessionStore } from '../src/surface/session-store.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeServer } from '../src/surface/server.js';

const postJson = async (base, path, body) => {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  assert.match(response.headers.get('content-type') ?? '', /application\/json/u, `${path} JSON 응답 아님: ${text.slice(0, 160)}`);
  return { status: response.status, body: JSON.parse(text) };
};

async function withServer(options, run) {
  const dir = options.dir ?? await mkdtemp(join(tmpdir(), 't5-w5-'));
  const tools = options.tools ?? demoTools();
  const env = options.env ?? demoEnv({ hands: Object.keys(tools.tools ?? {}) });
  const model = options.model ?? {
    async respond(_tc, call = {}) {
      return call.tools?.length ? { text: '요청을 확인했어요.', toolCalls: [] } : '요청을 확인했어요.';
    },
  };
  const server = makeServer({
    store: new SessionStore(dir),
    eventLog: new EventLog(dir),
    memStore: new MemoryStore(dir),
    automationStore: new AutomationJobStore(dir),
    tools, env, model, modelTimeoutMs: 0,
    processEnv: { GPAO_T5_TCELL: 'off' },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await run(`http://127.0.0.1:${server.address().port}`, dir);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function newSession(base) {
  const response = await postJson(base, '/sessions');
  assert.equal(response.status, 200);
  return response.body;
}

test('W5 로컬 문서: 일반 텍스트는 승인 없이 실제로 읽고 원본을 바꾸지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-w5-intake-'));
  const path = join(dir, '8월-매출메모.txt');
  const original = '매출 1,800만원\n비용 1,100만원\n신규 17명\n이탈 5명\n';
  await writeFile(path, original, 'utf8');
  const before = await stat(path);
  const localFile = makeLocalFileTool({ roots: [dir], dataDir: dir });
  const tools = demoTools({ localFile });
  const selfState = buildSelfState(demoEnv({ hands: Object.keys(tools.tools) }));

  const receipt = await tools.run('local.file', { action: 'read', path }, selfState);

  assert.equal(receipt.failureState, 'none');
  assert.equal(receipt.result.text, original, '사용자 자료의 줄과 수치를 그대로 보존해야 한다');
  assert.equal(receipt.actualCall.args.action, 'read');
  assert.equal(await readFile(path, 'utf8'), original, '읽기 흐름이 원본을 수정했다');
  assert.equal((await stat(path)).mtimeMs, before.mtimeMs, '읽기 흐름이 원본 시각을 건드렸다');
  assert.equal(localFile.previewOf({ action: 'read', path }), undefined, '읽기에 승인 카드를 요구하면 안 된다');
});

test('W5 로컬 문서: PDF·Word·Excel·HWP/HWPX를 사람이 읽을 본문으로 정규화한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-w5-rich-intake-'));
  const localFile = makeLocalFileTool({ roots: [dir], dataDir: dir });
  const formats = [
    ['계약서.pdf', Buffer.from('%PDF-1.7\ncompressed-object-stream')],
    ['견적서.docx', Buffer.from('PK\u0003\u0004word/document.xml')],
    ['정산표.xlsx', Buffer.from('PK\u0003\u0004xl/worksheets/sheet1.xml')],
    ['신청서.hwpx', Buffer.from('PK\u0003\u0004Contents/section0.xml')],
  ];

  const gaps = [];
  for (const [name, bytes] of formats) {
    const path = join(dir, name);
    await writeFile(path, bytes);
    const out = await localFile.handler({ action: 'read', path });
    const expectedFormat = name.split('.').at(-1);
    const document = out.result?.document;
    if (out.blocked) gaps.push(`${name}: intake blocked`);
    if (document?.format !== expectedFormat) gaps.push(`${name}: format missing`);
    if (!String(document?.text ?? '').trim()) gaps.push(`${name}: extracted text missing`);
    if (String(document?.text ?? '').includes('PK\u0003\u0004')) gaps.push(`${name}: raw archive bytes exposed`);
  }
  assert.deepEqual(gaps, [], `구조화 문서 intake 미구현:\n- ${gaps.join('\n- ')}`);
});

test('W5 보고서: 원본을 보존하고 승인 한 번 뒤 별도 결과물 파일을 실제로 만든다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-w5-report-'));
  const source = join(dir, '견적서-v3.md');
  const target = join(dir, '견적서-정리본.md');
  const original = '배송비 포함 최종 견적 1200원';
  await writeFile(source, original, 'utf8');
  let calls = 0;
  const model = {
    async respond(tc, options = {}) {
      if (tc?.workContractAssessment) return 'FILE';
      if (!options.tools?.length) return '별도 정리본을 만들었어요.';
      calls += 1;
      if (calls === 1) return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: source } }] };
      if (tc?.evidenceFacts?.some((fact) => fact.calledWith?.includes?.('write'))) {
        return { text: '별도 정리본을 만들었어요.', toolCalls: [] };
      }
      return { text: '', toolCalls: [{ name: 'local.file', args: {
        action: 'write', path: target, source, text: '# 견적 요약\n\n최종 견적: 1200원\n',
      } }] };
    },
  };
  const localFile = makeLocalFileTool({ roots: [dir], dataDir: dir });
  const tools = demoTools({ localFile });

  await withServer({ dir, tools, model }, async (base) => {
    const session = await newSession(base);
    const first = await postJson(base, '/turn', {
      sessionId: session.id,
      text: '견적서를 읽고 원본은 건드리지 말고 별도 보고서 파일로 만들어줘',
    });
    assert.equal(first.body.kind, 'approval', '쓰기 전에 필요한 승인 한 번으로 이어져야 한다');
    assert.ok(first.body.pendingId, '승인할 실행 신분이 없다');

    const done = await postJson(base, '/turn', { sessionId: session.id, approve: first.body.pendingId });
    assert.equal(done.body.kind, 'reply');
    assert.equal(done.body.pendingId, undefined, '같은 산출물에 승인을 반복 요구했다');
    await access(target);
    assert.match(await readFile(target, 'utf8'), /최종 견적: 1200원/u);
    assert.equal(await readFile(source, 'utf8'), original, '보고서 생성이 원본을 덮어썼다');
  });
});

test('W5 커뮤니케이션·콘텐츠: 평범한 초안 요청은 카드나 내부 절차 없이 바로 결과를 준다', async () => {
  const reply = '안녕하세요. 요청하신 일정은 8월 12일 오후 2시로 변경해 두겠습니다. 불편을 드려 죄송합니다.';
  const model = {
    async respond(_tc, options = {}) {
      return options.tools?.length ? { text: reply, toolCalls: [] } : reply;
    },
  };

  await withServer({ model }, async (base) => {
    const session = await newSession(base);
    const result = await postJson(base, '/turn', {
      sessionId: session.id,
      text: '고객에게 일정 변경 사과 문자를 정중하게 써줘',
    });
    assert.equal(result.body.kind, 'reply');
    assert.equal(result.body.reply, reply);
    assert.equal(result.body.pendingId, undefined);
    assert.equal(result.body.approvalPreview, undefined);
    assert.equal(result.body.automationSuggestion, undefined);
    assert.doesNotMatch(result.body.reply, /skill-|job-|run-|\/Users\/|\/tmp\//u, '내부 절차가 사용자 글에 노출됐다');
  });
});

test('W5 자료 조사: 읽은 내용은 출처와 결합되고 출처 없는 성공은 사용자에게 전달되지 않는다', async () => {
  const html = `<!doctype html><html><head><title>소상공인 지원 공고</title></head><body><main><h1>2026 지원사업</h1><p>${'공식 공고의 지원 대상과 신청 기간입니다. '.repeat(20)}</p></main></body></html>`;
  const collector = makeWebCollector({
    fetchImpl: async () => new Response(html, {
      status: 200, headers: { 'content-type': 'text/html' },
    }),
    robotsCheck: async () => true,
    now: () => 1234,
  });
  const tools = demoTools({ webCollector: collector });
  const selfState = buildSelfState(demoEnv({ hands: Object.keys(tools.tools) }));

  const good = await tools.run('web.collect', { url: 'https://example.com/notice' }, selfState);
  assert.equal(good.failureState, 'none');
  assert.equal(good.sources.length, 1);
  assert.equal(good.sources[0].sourceUrl, 'https://example.com/notice');
  assert.match(good.result.markdown, /지원 대상과 신청 기간/u);

  const badRunner = new ToolRunner({
    'bad.research': {
      sourceLedgerRequired: true,
      async handler() { return { result: { answer: '확인했습니다' }, userSafeSummary: '조사 완료' }; },
    },
  });
  const badState = buildSelfState({
    model: { id: 'm', authSignal: 'ok' },
    connections: [{ id: 'bad.research', connected: true, status: 'usable', hasHandler: true }],
  });
  const bad = await badRunner.run('bad.research', {}, badState);
  assert.equal(bad.failureState, 'failed');
  assert.match(bad.userSafeSummary, /출처를 확인하지 못해/u);
  assert.equal(bad.result, undefined, '근거 없는 조사 결과가 성공처럼 남았다');
});

test('W5 반복 업무: 후보 한 번만 제안하고 사용자 승인 전에는 자동 실행하지 않는다', async () => {
  await withServer({}, async (base) => {
    const session = await newSession(base);
    const first = await postJson(base, '/turn', {
      sessionId: session.id,
      text: '매주 금요일 로컬 파일 목록을 정리해줘',
    });
    assert.ok(first.body.automationSuggestion?.candidateId, '반복 업무 후보가 사용자에게 보이지 않는다');
    assert.equal(first.body.pendingId, undefined, '후보를 보여주는 단계에서 실행 승인을 강요했다');
    const view = await fetch(`${base}/automation`).then((response) => response.json());
    assert.equal(view.candidates.length, 1);
    assert.equal(view.jobs.length, 0, '사용자 승인 전 반복 작업이 자동으로 활성화됐다');
    assert.equal(view.runs.length, 0, '사용자 승인 전 실행 영수증이 생겼다');

    const second = await postJson(base, '/turn', {
      sessionId: session.id,
      text: '매주 금요일 로컬 파일 목록을 정리해줘',
    });
    assert.equal(second.body.automationSuggestion, undefined, '같은 후보 카드를 반복해서 보여준다');
  });
});

test('W5 처음 보는 연결: 없는 손을 성공이라 하지 않고 준비할 정보와 모델 상태를 정직하게 보여준다', async () => {
  await withServer({}, async (base) => {
    const session = await newSession(base);
    const turn = await postJson(base, '/turn', {
      sessionId: session.id,
      text: '처음 보는 내 크롤러 도구를 T5에서 쓸 수 있게 준비해줘',
    });
    assert.ok(turn.body.toolCandidate, '처음 보는 도구를 준비할 후보 흐름이 없다');
    assert.match(turn.body.toolCandidate.requestText, /크롤러/u);
    assert.equal(turn.body.pendingId, undefined, '구성도 안 된 도구에 실행 승인을 요구했다');

    const toolbox = await fetch(`${base}/toolbox`).then((response) => response.json());
    assert.equal(toolbox.tools.some((tool) => tool.id === turn.body.toolCandidate.id && tool.executable), false,
      '설정하지 않은 도구를 실행 가능하다고 표시했다');

    const health = await fetch(`${base}/model/health`).then((response) => response.json());
    assert.notEqual(health.state, 'usable', '검증하지 않은 데모 모델 연결을 사용 가능으로 과장했다');
    assert.ok(health.state === 'unverified' || health.userSafeSummary || health.nextSafeAction,
      '사용자가 다음에 무엇을 확인해야 하는지 알 수 없다');
  });
});
