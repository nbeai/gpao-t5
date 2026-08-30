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
