import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const evidence = JSON.parse(await readFile(new URL(
  '../evidence/nx2-se2-human-side-answer-2026-09-01.json', import.meta.url), 'utf8'));

test('SE-2는 오너 실제 Console과 main Work delta 0을 함께 통과한다', () => {
  assert.equal(evidence.status, 'SE2_COMPLETE');
  assert.equal(evidence.actualConsole.humanRunner, 'owner');
  assert.equal(evidence.actualConsole.panelOpened, true);
  assert.equal(evidence.actualConsole.layout, 'fixed floating overlay');
  assert.equal(evidence.actualConsole.mainConversationWidthChanged, false);
  assert.equal(evidence.actualConsole.sideQuestionAnswered, true);
  assert.equal(evidence.canonicalReality.mainConversationMessageEventsAfter,
    evidence.canonicalReality.mainConversationMessageEventsBefore);
  assert.equal(evidence.canonicalReality.workEventsAfterSideOpen, 0);
  assert.equal(evidence.canonicalReality.artifactPublications, 0);
  assert.equal(evidence.next.se3Open, true);
});
