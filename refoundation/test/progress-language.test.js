import test from 'node:test';
import assert from 'node:assert/strict';

import {
  modelProgressText, safeProgressText, toolCompletedProgressText, toolProgressText,
} from '../src/progress-language.js';

test('진행 언어는 판단을 말하지 않고 실제 작업 단계에 맞는 고정 문구를 쓴다', () => {
  assert.equal(modelProgressText(1), '요청을 이해하고 있어요');
  assert.equal(modelProgressText(2), '확인한 내용을 바탕으로 다음 단계를 생각하고 있어요');
  assert.equal(safeProgressText('이제 거의 다 됐어요'), '작업을 이어가고 있어요');

  const starts = [
    ['web_search', {}, '웹에서 관련 자료를 찾고 있어요'],
    ['web_read', {}, '선택한 자료를 자세히 읽고 있어요'],
    ['video_text', { action: 'read' }, '영상의 실제 자막을 확인하고 있어요'],
    ['browser', { action: 'navigate' }, '요청한 페이지를 열고 있어요'],
    ['browser', { action: 'snapshot' }, '페이지 내용을 살펴보고 있어요'],
    ['browser', { action: 'download' }, '파일을 내려받고 있어요'],
    ['attachment', { action: 'inspect' }, '첨부 파일의 내용을 살펴보고 있어요'],
    ['attachment', { action: 'register_output' }, '결과 파일을 준비하고 있어요'],
    ['skill', { action: 'search' }, '알맞은 작업 방법을 찾고 있어요'],
    ['cli_prepare', { action: 'install' }, '검증된 컴퓨터 도구를 준비하고 있어요'],
    ['capability_evidence', { action: 'inspect' }, '이 능력이 실제로 쓰인 결과를 살펴보고 있어요'],
    ['capability_compare', { action: 'compare' }, '이전 방법과 새 방법의 실제 결과를 비교하고 있어요'],
    ['capability_lifecycle', { action: 'apply' }, '확인된 제안을 안전하게 적용하고 있어요'],
    ['memory', { action: 'list' }, '기억해 둔 내용을 확인하고 있어요'],
    ['memory', { action: 'replace' }, '기억할 내용을 정리하고 있어요'],
    ['session_search', { action: 'search' }, '지난 대화에서 관련 내용을 찾고 있어요'],
    ['conversation_recall', { action: 'read' }, '이전 작업 결과를 다시 읽고 있어요'],
    ['exec', { effect: { kind: 'observe' } }, '컴퓨터에서 필요한 정보를 확인하고 있어요'],
    ['exec', { effect: { kind: 'local_change' } }, '컴퓨터에서 요청한 작업을 진행하고 있어요'],
    ['terminal_session', { action: 'start' }, '시간이 걸리는 작업을 시작하고 있어요'],
    ['terminal_session', { action: 'poll' }, '진행 중인 작업의 상태를 확인하고 있어요'],
    ['terminal_session', { action: 'start_tty' }, '대화형 터미널 작업을 시작하고 있어요'],
    ['terminal_session', { action: 'read_output' }, '필요한 컴퓨터 작업 결과를 정확히 확인하고 있어요'],
  ];
  for (const [name, args, expected] of starts) assert.equal(toolProgressText(name, args), expected);
  assert.ok(new Set(starts.map(([, , text]) => text)).size >= 15);

  assert.equal(toolCompletedProgressText('web_search', {}), '찾은 자료들을 비교하고 있어요');
  assert.equal(toolCompletedProgressText('web_read', {}), '읽은 내용을 요청과 맞춰보고 있어요');
  assert.equal(toolCompletedProgressText('video_text', {}), '확인한 자막 범위를 요청과 맞춰보고 있어요');
  assert.equal(toolCompletedProgressText('browser', {}), '화면에서 확인한 내용을 정리하고 있어요');
  assert.equal(toolCompletedProgressText('attachment', {}), '파일에서 확인한 내용을 정리하고 있어요');
  assert.equal(toolCompletedProgressText('exec', {}), '컴퓨터 작업 결과를 다시 확인하고 있어요');
  assert.equal(toolCompletedProgressText('terminal_session', {}), '진행 중인 컴퓨터 작업 결과를 확인하고 있어요');

  const publicTexts = [
    modelProgressText(1), modelProgressText(2), safeProgressText('secret-token'),
    ...starts.map(([name, args]) => toolProgressText(name, args)),
    ...['web_search', 'web_read', 'video_text', 'browser', 'attachment', 'exec']
      .map((name) => toolCompletedProgressText(name, {})),
  ];
  for (const text of publicTexts) assert.doesNotMatch(text, /판단/u);
  assert.equal(safeProgressText('secret-token'), '작업을 이어가고 있어요');
  assert.doesNotMatch(safeProgressText('secret-token'), /secret-token/u);
});
