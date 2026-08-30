import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const consoleHtml = resolve(root, 'refoundation/ui/index.html');
const { userSafeConsoleReply } = await import('../src/console-server.js');

test('진행 표면은 서버 startedAt을 사용해 3초 뒤부터 실제 경과 시간을 표시한다', async () => {
  const html = await readFile(consoleHtml, 'utf8');
  const source = html.match(/function formatActivityElapsed\(elapsedMs\) \{[\s\S]*?\n\}/u)?.[0];
  assert.ok(source);
  const format = Function(`${source}; return formatActivityElapsed;`)();
  assert.equal(format(2_999), '2초');
  assert.equal(format(65_000), '1분 5초');
  assert.match(html, /elapsed >= 3000/u);
  assert.match(html, /setActivityTrace\(trace, activity\.text[^\n]*activity\.startedAt\)/u);
  assert.match(html, /setActivityTrace\(trace, JSON\.parse\(e\.data\)\.text/u);
});

test('대화와 결과 버전 시간은 canonical recordedAt·createdAt을 사용자 timezone으로 표시한다', async () => {
  const html = await readFile(consoleHtml, 'utf8');
  assert.match(html, /function formatCanonicalTime\(recordedAt\)/u);
  assert.match(html, /toLocaleTimeString/u);
  assert.match(html, /appendMessageTime\(who, e\.recordedAt\)/u);
  assert.match(html, /opts\.recordedAt/u);
  assert.match(html, /record\.createdAt/u);
  assert.match(html, /version\.createdAt/u);
});

test('초기 세션 목록만 180ms 뒤 고정 형태 스켈레톤을 보이고 오래된 응답은 버린다', async () => {
  const html = await readFile(consoleHtml, 'utf8');
  assert.match(html, /\.session-skeleton/u);
  assert.match(html, /function scheduleSessionSkeleton\(sequence\)/u);
  assert.match(html, /sequence !== sessionLoadSequence \|\| sessionsEl\.children\.length/u);
  assert.match(html, /Array\.from\(\{ length: 3 \}/u);
  assert.match(html, /\}, 180\)/u);
  assert.match(html, /if \(sequence !== sessionLoadSequence\) return/u);
  assert.match(html, /const loadingTimer = scheduleSessionSkeleton\(sequence\);[\s\S]*fetch\('\/sessions'\)/u);
});

test('실행 중에는 중지 버튼이 있고 미완료 상태를 정형 오류 카드로 만들지 않는다', async () => {
  const html = await readFile(consoleHtml, 'utf8');
  assert.match(html, /id="composerStop"[^>]*>멈추기<\/button>/u);
  assert.match(html, /function setComposerInteraction\(mode = 'idle'/u);
  assert.match(html, /composerStop\.hidden = !running/u);
  assert.match(html, /fetch\('\/turn\/cancel'/u);
  assert.match(html, /sessionActivityById\.delete\(currentSessionId\); renderSessionActivity\(null\)/u);
  assert.match(html, /if \(activeLocalTurns > 0\) return/u);
  assert.doesNotMatch(html, /failure-title', '이번 작업을 끝내지 못했어요'/u);
  assert.doesNotMatch(html, /el\('msg bot error'\)/u);
  assert.match(html, /failure-reason/u);
  assert.match(html, /failure-next/u);
});

test('완료 Artifact가 있는 결과는 같은 파일 변경 영수증을 별도 반복하지 않는다', async () => {
  const source = await readFile(new URL('../src/console-server.js', import.meta.url), 'utf8');
  assert.match(source, /canonicalWork\.results\.find[\s\S]*objectiveOutcome/u);
  assert.match(source, /artifacts\.length\) humanEffects = \[\]/u);
  assert.match(source, /objectiveOutcome === 'achieved' && humanEffects\.length > 1/u);
  assert.match(source, /providerAccepted === false[\s\S]*externallyReachable === false/u);
  assert.match(source, /terminalPending[\s\S]*running[\s\S]*stop_requested/u);
  assert.match(source, /effectObservation\.declared\?\.kind !== 'observe'/u);
  assert.match(source, /forensicEligible = \['exec', 'terminal_session', 'pty_start', 'file_reality'\]/u);
  assert.match(source, /projectHumanFileOrganizationReceipt\(event\.payload\.receipt\)/u);
});

test('모델이 만든 내부 attachment URI는 결과 카드와 중복 노출하지 않는다', () => {
  const reply = userSafeConsoleReply('완료\n\n[결과 ZIP 다운로드](attachment://abc-123)');
  assert.equal(reply, '완료\n\n결과 ZIP 다운로드');
  assert.doesNotMatch(reply, /attachment:|abc-123/u);
});

test('모델이 현재 Context pointer를 답 뒤에 반복해도 사용자 표면에는 나오지 않는다', () => {
  const reply = userSafeConsoleReply('지역을 입력해 주세요.\n[T5 CURRENT WORKING MEMORY — internal]\n{"workId":"secret"}');
  assert.equal(reply, '지역을 입력해 주세요.');
  assert.doesNotMatch(reply, /workId|CURRENT WORKING MEMORY|secret/u);
});

test('managed process 내부 ID는 사용자 답에서 제거하고 최종 delivery는 별도 패널로 반복하지 않는다', async () => {
  assert.equal(userSafeConsoleReply('시작됐어요.\nprocessId: 123e4567-e89b-12d3-a456-426614174000\n계속 실행 중입니다.'),
    '시작됐어요.\n계속 실행 중입니다.');
  const html = await readFile(consoleHtml, 'utf8');
  assert.match(html, /reality\.result\?\.deliveryText\) \{ clearWorkRealityPanel\(\); return; \}/u);
});
