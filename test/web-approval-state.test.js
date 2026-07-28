import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { approvalIsActive, projectionOptions } from '../src/surface/web/approval-state.js';

test('마지막 결과의 현재성과 승인 활성성은 분리된다', () => {
  const active = ['live-1'];
  const latest = projectionOptions(3, 3, active);

  assert.equal(latest.historical, false, '마지막 결과는 현재 표면');
  assert.equal(latest.activePendingIds, active, '마지막에도 서버의 활성 승인 목록을 잃지 않는다');
  assert.equal(approvalIsActive('live-1', latest.activePendingIds, latest.historical), true);
  assert.equal(approvalIsActive('expired-1', latest.activePendingIds, latest.historical), false,
    '마지막 결과라도 활성 목록에 없으면 지난 승인');
});

test('이전 결과와 활성 목록 없는 직접 렌더의 폴백을 구분한다', () => {
  const previous = projectionOptions(1, 3, []);

  assert.equal(previous.historical, true);
  assert.equal(approvalIsActive('old-1', previous.activePendingIds, previous.historical), false);
  assert.equal(approvalIsActive('direct-current', undefined, false), true,
    '세션 투영이 아닌 현재 직접 렌더는 기존 동작 유지');
  assert.equal(approvalIsActive('direct-old', undefined, true), false);
});

test('Work Chat은 현재 표면과 승인 활성성을 각각의 사실로 배선한다', async () => {
  const html = await readFile(new URL('../src/surface/web/index.html', import.meta.url), 'utf8');

  assert.match(html, /projectionOptions\(i, 마지막, active\)/,
    '마지막 결과에도 서버의 활성 승인 목록을 전달한다');
  assert.match(html, /approvalIsActive\(r\.pendingId, activePendingIds, historical\)/,
    '승인 버튼은 공통 활성 판정을 쓴다');
  assert.match(html, /!historical && r\.surfaceRequest\?\.kind === 'secret_input'/,
    '마지막 결과의 비밀 입력면은 현재성으로 유지한다');
});
