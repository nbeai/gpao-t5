#!/usr/bin/env node
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { runAgent } from '../src/agent-loop.js';
import { makeStoredChatGptCredentialSource, makeStoredModelCredentialCatalog } from '../src/chatgpt-oauth-credential.js';
import { makeChatGptResponsesModel } from '../src/chatgpt-responses-model.js';
import { consoleInstructions } from '../src/console-model-factory.js';
import { makeBingSearchProvider } from '../src/bing-search-provider.js';
import { makeDuckDuckGoSearchProvider } from '../src/duckduckgo-search-provider.js';
import { makeNaverSearchProvider } from '../src/naver-search-provider.js';
import { makeOpenAIResponsesModel } from '../src/openai-responses-model.js';
import { makePromptDumper } from '../src/prompt-dump.js';
import { makeRemoteMcpTool } from '../src/remote-mcp-tool.js';
import { deferTools, makeToolSearchTool } from '../src/tool-search.js';
import { makeWebReadTool } from '../src/web-read-tool.js';
import { makeWebResearchTool } from '../src/web-research-tool.js';
import { makeWebSearchTool } from '../src/web-search-tool.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const connectionFile = process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json');
const caseFilter = option('--case');
const keep = process.argv.includes('--keep');
const liveWeb = process.argv.includes('--live-web');
const selected = await makeStoredModelCredentialCatalog({ file: connectionFile }).select(option('--connection'));
const room = await mkdtemp(join(tmpdir(), 't5-tool-routing-'));
const home = join(room, 'home');
const data = join(room, 'data');
const workspace = join(room, 'workspace');
await Promise.all([home, data, workspace].map((path) => mkdir(path, { recursive: true })));

const instructions = consoleInstructions(workspace);
function modelFor(caseId) {
  if (selected.kind === 'chatgpt_oauth') return makeChatGptResponsesModel({
    credentials: makeStoredChatGptCredentialSource({ file: connectionFile }),
    model: selected.modelId,
    endpoint: process.env.T5_REFOUNDATION_CHATGPT_ENDPOINT,
    instructions,
    dump: makePromptDumper({ directory: join(data, 'prompt', caseId) }),
  });
  if (selected.kind === 'api_key') {
    const base = String(selected.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/u, '');
    return makeOpenAIResponsesModel({
      apiKey: selected.apiKey, model: selected.modelId,
      endpoint: process.env.T5_REFOUNDATION_OPENAI_ENDPOINT ?? `${base}/responses`,
      instructions,
      dump: makePromptDumper({ directory: join(data, 'prompt', caseId), sensitiveValues: [selected.apiKey] }),
    });
  }
  throw new Error('unsupported qualification model connection');
}

function tool(name, description, { searchTerms = [], result = null } = {}) {
  return {
    name, description, searchTerms,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute() { return structuredClone(result ?? { state: 'qualification_observed', tool: name }); },
  };
}

let core = [
  tool('connection', 'Inspect the current truth before claiming that T5 can connect, link, integrate, or use account data from an external workspace, service, channel, local sync folder, CLI, API, or browser login.', {
    result: { state: 'listed', connections: [{ id: 'linear', state: 'connected', capabilities: { read: true } }] },
  }),
  tool('memory', 'Manage user-controlled durable memory that represents current state across conversations, not a history of everything that happened. Past work remains in conversation history or session search.', {
    result: { state: 'listed', items: [] },
  }),
  tool('skill', 'Skills are optional on-demand procedures for using existing tools. Search or view one only when a detailed procedure is needed.', {
    result: { state: 'searched', skills: [] },
  }),
  tool('exec', 'Run a foreground command to completion and return its complete observed stdout, stderr, and exit status in one result.', {
    result: { state: 'not_executed', reason: 'routing qualification does not execute commands' },
  }),
  tool('web_search', 'Search the public web and return candidate sources only. This does not read page contents; choose a candidate and call web_read to inspect it.', {
    result: { state: 'candidates', observedPageContent: false, candidates: [
      { title: 'A', url: 'https://a.example/', snippet: 'fixture A' },
      { title: 'B', url: 'https://b.example/', snippet: 'fixture B' },
      { title: 'C', url: 'https://c.example/', snippet: 'fixture C' },
    ] },
  }),
  tool('web_read', 'Read one exact public HTTP(S) URL. Returns observed source identity, redirects, content type, readable text, and honest login, dynamic, block, and truncation boundaries.', {
    result: { state: 'read', content: { text: '격리된 출처의 관측 사실' } },
  }),
  tool('attachment', 'Inspect a user attachment with the smallest sufficient observation or register a verified workspace output as a result artifact.', {
    result: { state: 'listed', attachments: [] },
  }),
];

const linear = makeRemoteMcpTool({
  id: 'linear', label: 'Linear',
  runtime: {
    async listTools() { return [{
      name: 'list_issues', description: 'List current issues', inputSchema: { type: 'object' },
      annotations: { readOnlyHint: true, destructiveHint: false },
    }]; },
    async callTool() { return {
      content: [{ type: 'text', text: '{"issues":[{"title":"견적 검토","due":"today"}]}' }],
      isError: false,
    }; },
  },
  authorizeEffect: async () => { throw new Error('read-only qualification must not request external authority'); },
});

let deferred = [
  tool('automation', 'Create, inspect, pause, resume, cancel, or run a durable scheduled task.', {
    searchTerms: ['schedule recurring daily weekly monthly future cron reminder', '예약 반복 매일 매주 매월 나중 알림'],
    result: { state: 'listed', jobs: [{ id: 'job-1', name: '주간 보고', state: 'scheduled' }] },
  }),
  tool('session_search', 'Search or read the user’s canonical past T5 conversations. Use search for exact words, phrases, paths, decisions, or prior work; then read the returned canonical context. Do not claim no prior conversation before searching.', {
    result: { state: 'searched', results: [{ sessionId: 'past-1', messageId: 'm-1', snippet: '납기는 9월 5일로 정한다.' }] },
  }),
  tool('web_research', 'Research a public-web question through focused searches and parallel reading of distinct source domains.', {
    searchTerms: ['multi source research', 'current trends evidence', '웹 리서치', '시장 조사', '여러 출처'],
    result: { state: 'researched', readableCount: 3, sources: [
      { title: 'A', candidateUrl: 'https://a.example/', state: 'read', content: { text: '소비 신호 A' } },
      { title: 'B', candidateUrl: 'https://b.example/', state: 'read', content: { text: '소비 신호 B' } },
      { title: 'C', candidateUrl: 'https://c.example/', state: 'read', content: { text: '소비 신호 C' } },
    ], stopFurtherResearch: true, deactivatedTools: ['web_research'] },
  }),
  tool('cli_prepare', 'Find and prepare a trusted T5-managed command capability from pinned official releases.', {
    result: { state: 'searched', packages: [{ id: 'jq', defaultVersion: '1.8.2', installedVersion: null }] },
  }),
  tool('capability_catalog', 'Search the trusted bundled catalog only when the current tools, skills, and connection truth do not provide a needed capability. This catalog contains pre-install candidates and exact blockers; finding one does not mean it is installed, connected, or user-startable.', {
    result: { state: 'searched', candidates: [{ id: 'asana', state: 'candidate', preparation: 'product_registration_required', canStart: false }] },
  }),
  tool('capability_evidence', 'Read observed use of prepared methods and managed commands when the user asks whether they are actually being used or remain useful.', {
    result: { state: 'inspected', capability: { kind: 'cli', id: 'jq', usageRuns: 2, completedUsageRuns: 2, failedUsageRuns: 0 } },
  }),
  linear,
];

let cases = [
  {
    id: 'past-conversation',
    request: '현재 메모가 아니라 지난 대화 원문에서 내가 정한 납기 결정을 찾아줘.',
    expected: ['session_search'], allowCoreBeforeSearch: [],
  },
  {
    id: 'scheduled-work',
    request: '앞으로 예약된 반복 작업 목록을 확인해줘.',
    expected: ['automation'], allowCoreBeforeSearch: [],
  },
  {
    id: 'multi-source-research',
    request: '서로 다른 여러 공개 출처를 조사해서 최근 소상공인 소비 흐름을 정리해줘.',
    expected: ['web_research'], allowCoreBeforeSearch: [],
  },
  {
    id: 'managed-cli',
    request: 'jq가 없을 때 쓸 수 있는 T5 검증 관리본 후보와 준비 방법만 확인해줘. 지금 설치는 하지 마.',
    expected: ['cli_prepare'], allowCoreBeforeSearch: ['exec'],
  },
  {
    id: 'missing-connection-candidate',
    request: '아직 연결하지 않은 Asana의 공식 연결 후보와 지금 막힌 조건을 찾아봐.',
    expected: ['capability_catalog'], allowCoreBeforeSearch: ['connection'],
  },
  {
    id: 'capability-use-evidence',
    request: '전에 T5가 준비한 jq 관리본이 실제 작업에서 쓰였는지 사용 근거를 확인해줘.',
    expected: ['capability_evidence'], allowCoreBeforeSearch: [],
  },
  {
    id: 'remote-mcp-observe',
    request: '이미 연결된 Linear에서 오늘 마감 이슈를 조회해줘.',
    expected: ['linear'], allowCoreBeforeSearch: ['connection'], requiredCallEffect: 'observe',
  },
];

if (liveWeb) {
  const webSearch = makeWebSearchTool({ providers: [
    makeNaverSearchProvider(), makeDuckDuckGoSearchProvider(), makeBingSearchProvider(),
  ] });
  const webRead = makeWebReadTool();
  const webResearch = makeWebResearchTool({ searchTool: webSearch, readTool: webRead });
  core = core.map((entry) => entry.name === 'web_search' ? webSearch
    : entry.name === 'web_read' ? webRead : entry);
  core.push(webResearch);
  deferred = deferred.filter((entry) => entry.name !== 'web_research');
  cases = [
    {
      id: 'live-web-direct',
      request: '서로 다른 여러 공개 출처를 직접 읽어서 2026년 한국 소상공인 소비 흐름을 근거와 함께 정리해줘.',
      expected: ['web_research'], allowCoreBeforeSearch: ['web_research'],
    },
    {
      id: 'live-web-contrast',
      request: '한 출처 요약으로 끝내지 말고 최근 한국 자영업 소비 변화를 여러 독립된 공개 자료로 교차 확인해줘.',
      expected: ['web_research'], allowCoreBeforeSearch: ['web_research'],
    },
    {
      id: 'live-web-evidence',
      request: '공개 통계와 기관 자료 등 서로 다른 도메인을 조사해서 요즘 한국 소상공인 매출과 소비 신호를 비교해줘.',
      expected: ['web_research'], allowCoreBeforeSearch: ['web_research'],
    },
  ];
}

const previousHome = process.env.T5_REFOUNDATION_HOME;
process.env.T5_REFOUNDATION_HOME = home;
const results = [];
try {
  for (const scenario of cases.filter((entry) => !caseFilter || entry.id === caseFilter)) {
    const offered = deferTools([...core, ...deferred], { coreNames: core.map((entry) => entry.name) });
    offered.unshift(makeToolSearchTool({ tools: deferred }));
    let result; const startedAt = Date.now();
    try {
      result = await runAgent({
        request: scenario.request, model: modelFor(scenario.id), tools: offered, maxModelTurns: 8,
      });
    } catch (error) {
      results.push({
        id: scenario.id, status: 'failed', modelTurns: null, answer: '', calls: [], searchQueries: [],
        activated: [], expected: scenario.expected, unexpectedDeferred: [], disallowedCore: [],
        error: { message: error?.message ?? String(error), reason: error?.reason ?? null, toolName: error?.toolName ?? null },
        passed: false,
      });
      continue;
    }
    const calls = result.receipts.map((receipt) => receipt.requestedCall.name);
    const searches = result.receipts.filter((receipt) => receipt.requestedCall.name === 'tool_search');
    const activated = searches.flatMap((receipt) => receipt.result?.activatedTools ?? []);
    const unexpectedDeferred = activated.filter((name) => !scenario.expected.includes(name));
    const firstSearchIndex = calls.indexOf('tool_search');
    const coreBeforeSearch = firstSearchIndex < 0 ? calls : calls.slice(0, firstSearchIndex);
    const disallowedCore = coreBeforeSearch.filter((name) => !scenario.allowCoreBeforeSearch.includes(name));
    const expectedEffectObserved = scenario.requiredCallEffect == null || result.receipts.some((receipt) => (
      scenario.expected.includes(receipt.requestedCall.name)
      && receipt.requestedCall.args?.action === 'call'
      && receipt.requestedCall.args?.effect?.kind === scenario.requiredCallEffect
      && receipt.actualCall?.name === receipt.requestedCall.name
    ));
    const researchReceipt = result.receipts.find((receipt) => receipt.requestedCall.name === 'web_research');
    const researchIndex = result.receipts.findIndex((receipt) => receipt.requestedCall.name === 'web_research');
    const liveWebEvidencePassed = !liveWeb || (
      researchReceipt?.outcome === 'succeeded'
      && Number(researchReceipt.result?.readableCount ?? 0) >= 3
      && result.status === 'completed'
    );
    const tokenUsage = result.modelCalls.reduce((totals, call) => ({
      input: totals.input + Number(call.usage?.input_tokens ?? 0),
      output: totals.output + Number(call.usage?.output_tokens ?? 0),
      total: totals.total + Number(call.usage?.total_tokens ?? 0),
      cached: totals.cached + Number(call.usage?.input_tokens_details?.cached_tokens ?? 0),
    }), { input: 0, output: 0, total: 0, cached: 0 });
    results.push({
      id: scenario.id, status: result.status, modelTurns: result.modelTurns,
      answer: String(result.answer ?? '').slice(0, 500),
      wallMs: Date.now() - startedAt, tokenUsage,
      calls, searchQueries: searches.map((receipt) => receipt.requestedCall.args.query),
      activated, expected: scenario.expected, unexpectedDeferred, disallowedCore, expectedEffectObserved,
      liveWebEvidencePassed,
      ...(liveWeb ? {
        research: researchReceipt ? {
          outcome: researchReceipt.outcome,
          state: researchReceipt.result?.state ?? null,
          readableCount: researchReceipt.result?.readableCount ?? null,
          selectedCount: researchReceipt.result?.selectedCount ?? null,
          stopFurtherResearch: researchReceipt.result?.stopFurtherResearch === true,
          sourceDomains: [...new Set((researchReceipt.result?.sources ?? []).flatMap((source) => {
            try { return [new URL(source.candidateUrl).hostname]; } catch { return []; }
          }))],
        } : null,
        callsAfterResearch: researchIndex < 0 ? []
          : result.receipts.slice(researchIndex + 1).map((receipt) => receipt.requestedCall.name),
      } : {}),
      passed: result.status === 'completed'
        && scenario.expected.every((name) => activated.includes(name) || calls.includes(name))
        && unexpectedDeferred.length === 0 && disallowedCore.length === 0
        && expectedEffectObserved && liveWebEvidencePassed,
    });
  }
  console.log(JSON.stringify({
    schema: 't5.tool-routing-qualification.v1',
    connectionId: selected.id, provider: selected.provider, model: selected.modelId,
    initialVisibleTools: ['tool_search', ...core.map((entry) => entry.name)],
    results, passed: results.every((result) => result.passed), room: keep ? room : null,
  }, null, 2));
  if (!results.every((result) => result.passed)) process.exitCode = 1;
} finally {
  if (previousHome == null) delete process.env.T5_REFOUNDATION_HOME;
  else process.env.T5_REFOUNDATION_HOME = previousHome;
  if (!keep) await rm(room, { recursive: true, force: true });
}
