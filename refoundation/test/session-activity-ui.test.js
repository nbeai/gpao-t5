import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('세션 전환 UI는 제출 세션을 고정하고 목록·재진입에서 진행 상태를 복원한다', async () => {
  const html = await readFile(resolve(root, 'refoundation/ui/index.html'), 'utf8');
  const wake = await readFile(resolve(root, 'refoundation/src/wake-events.js'), 'utf8');
  assert.match(html, /submittedSessionId/u);
  assert.match(html, /renderSessionActivity/u);
  assert.match(html, /sess-status/u);
  assert.match(html, /t5:session-activity/u);
  assert.match(wake, /session_activity/u);
  assert.match(wake, /t5:session-activity/u);
  assert.doesNotMatch(html, /모델 또는 터미널 작업을 완료하지 못했어요/u);
});

test('Work 현실 패널은 canonical version과 showPanel을 따르고 사용자 문장만 그린다', async () => {
  const html = await readFile(resolve(root, 'refoundation/ui/index.html'), 'utf8');
  const wake = await readFile(resolve(root, 'refoundation/src/wake-events.js'), 'utf8');
  const start = html.indexOf('function renderWorkReality');
  const end = html.indexOf('/** 서버에서 현재 대화를', start);
  const renderer = html.slice(start, end);
  assert.match(html, /t5:work-reality/u);
  assert.match(wake, /work_reality/u);
  assert.match(renderer, /Number\(reality\.version\) < Number\(previous\.version\)/u);
  assert.match(renderer, /reality\.showPanel !== true/u);
  assert.match(renderer, /reality\.recap/u);
  assert.match(renderer, /panel\.appendChild\(el\(null, line\)\)/u);
  assert.match(renderer, /realitySessionId !== currentSessionId/u);
  assert.doesNotMatch(renderer, /innerHTML|runId|workId|startedAt|recordedAt|toISOString/u);
  assert.match(html, /\.trace\[hidden\] \{ display:none; \}/u);
  assert.match(renderer, /activeLocalTurns > 0 && liveTrace/u);
  assert.match(renderer, /work-reality-panel'\)\?\.remove/u);
  assert.match(renderer, /liveTrace\.hidden = false/u);
  assert.match(html, /trace\.hidden = false/u);
  assert.match(html, /composerStop\.hidden = !running/u);
  assert.match(html, /setComposerInteraction\(activity\.steps\?\.length \? 'working' : 'responding'\)/u);
});

test('도구 없는 직접 답변도 입력 직후 본문에 한 줄 진행 상태를 보이고 첫 답변에서 교체한다', async () => {
  const html = await readFile(resolve(root, 'refoundation/ui/index.html'), 'utf8');
  const submitStart = html.indexOf("const trace = el('trace', '요청을 이해하고 있어요…')");
  const streamStart = html.indexOf('async function streamTurn', submitStart);
  const submitProjection = html.slice(submitStart, streamStart);
  assert.match(submitProjection, /trace\.hidden = false/u);
  assert.doesNotMatch(submitProjection, /trace\.hidden = true/u);
  const answerStart = html.indexOf("es.addEventListener('answer_delta'");
  const answerEnd = html.indexOf('const completed =', answerStart);
  assert.match(html.slice(answerStart, answerEnd), /trace\.hidden = true/u);
});

test('Artifact 인간 영수증은 기존 카드 안에서 접혀 있고 textContent만 사용한다', async () => {
  const html = await readFile(resolve(root, 'refoundation/ui/index.html'), 'utf8');
  const start = html.indexOf('function appendHumanArtifactReceipt');
  const end = html.indexOf('function renderArtifacts', start);
  const renderer = html.slice(start, end);
  assert.match(renderer, /document\.createElement\('details'\)/u);
  assert.match(renderer, /summary\.textContent/u);
  assert.match(renderer, /details\.appendChild/u);
  assert.doesNotMatch(renderer, /innerHTML|attachmentId|runId|sha256|sourcePath/u);
});

test('Effect forensic은 바뀐 것·확인 범위·rollback·unknown을 접힌 사용자 언어로 그린다', async () => {
  const html = await readFile(resolve(root, 'refoundation/ui/index.html'), 'utf8');
  const start = html.indexOf('function renderHumanEffects');
  const end = html.indexOf('function renderArtifacts', start);
  const renderer = html.slice(start, end);
  assert.match(renderer, /document\.createElement\('details'\)/u);
  assert.match(renderer, /receipt\.rollback/u);
  assert.match(renderer, /receipt\.unknowns/u);
  assert.doesNotMatch(renderer, /innerHTML|path|command|runId|toolCallId|sha256/u);
});

test('작업 기록은 sidebar에서 사용자가 펼칠 때만 읽고 opaque handle로 detail을 연다', async () => {
  const html = await readFile(resolve(root, 'refoundation/ui/index.html'), 'utf8');
  assert.match(html, /<details class="work-history" id="workHistory">/u);
  assert.match(html, /if \(event\.currentTarget\.open\) loadWorkHistory/u);
  assert.match(html, /workHistoryQuery/u);
  assert.match(html, /payload\.nextCursor/u);
  assert.match(html, /work-history\/\$\{encodeURIComponent\(item\.historyHandle\)\}/u);
  const start = html.indexOf('async function loadWorkHistory');
  const end = html.indexOf("document.getElementById('listtabs')", start);
  const renderer = html.slice(start, end);
  assert.doesNotMatch(renderer, /innerHTML|runId|workId|toolCallId|sha256|filePath/u);
});
