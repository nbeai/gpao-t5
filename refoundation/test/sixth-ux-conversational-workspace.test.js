import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ui = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');
const server = await readFile(new URL('../src/console-server.js', import.meta.url), 'utf8');
const evidence = JSON.parse(await readFile(new URL(
  '../evidence/s6-ux-conversational-workspace-2026-08-30.json', import.meta.url,
), 'utf8'));

test('S6-UX는 assistant flat body와 사용자 bubble을 분리하고 진행 통제를 composer 하나에 둔다', () => {
  assert.match(ui, /\.msg\.bot \{ align-self:stretch; width:100%; max-width:none; padding:0; border:0/u);
  assert.match(ui, /\.me \{ align-self:flex-end; width:fit-content/u);
  assert.match(ui, /id="composerStop"/u); assert.match(ui, /setComposerInteraction/u);
  assert.equal((ui.match(/id="composerStop"/gu) ?? []).length, 1);
  assert.doesNotMatch(ui, /className = 'stopbtn'/u);
});

test('Artifact 표면은 raw path 없이 같은 identity의 download·exact reveal·durable Undo만 연다', () => {
  assert.match(ui, /record\.revealUrl[\s\S]*artifactAction\(record, 'reveal'\)/u);
  assert.match(ui, /record\.undoUrl[\s\S]*artifactAction\(record, 'undo'\)/u);
  assert.match(server, /record\.sourcePath[\s\S]*exactFile: true, bytes: record\.bytes, sha256: record\.sha256/u);
  assert.match(server, /publicationForArtifact[\s\S]*workspacePatchForSession/u);
  assert.equal(evidence.artifactIdentity.rawPathInUserSurface, false);
});

test('수동 group과 pin은 Session metadata만 사용하고 실제 Browser mission을 통과했다', () => {
  assert.match(ui, /id="groupDialog"/u); assert.match(ui, /session-groups\/assign/u);
  assert.equal(evidence.productPrinciples.sessionContentCopiedForGroups, false);
  assert.ok(evidence.actualConsole.missions.every((mission) => mission.status === 'PASS'));
  assert.deepEqual(evidence.productIntegration, { passed: 205, failed: 0, skippedWindows: 2 });
  assert.equal(evidence.waDeltaAudit.duplicateTruthOwner, 0);
  assert.equal(evidence.waDeltaAudit.blindRetryCycle, 0);
});

test('상단 chip은 모델 연결 사실만 말하고 현재 Work 상태와 준비됨 표현으로 충돌하지 않는다', () => {
  assert.match(ui, /healthIssue \? '연결 확인 필요' : '연결됨'/u);
  assert.doesNotMatch(ui, /healthIssue \? '모델 확인 필요' : '준비됨'/u);
  assert.match(ui, /responding: '답변을 준비하고 있어요'/u);
  assert.match(ui, /working: '작업 중이에요 · 지금도 교정할 수 있어요'/u);
});
