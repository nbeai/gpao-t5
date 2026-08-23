import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TEXT_TABULAR_CASUAL_TURNS, TEXT_TABULAR_TURNS,
  assessTextTabularQualification, createTextTabularFixtureBytes,
} from '../src/text-tabular-qualification.js';

function passingInput() {
  const fixtures = createTextTabularFixtureBytes();
  const observations = [
    { kind: 'text', encoding: 'utf-16le', text: '8월 3일: 총 4.5시간, 휴게 포함 여부 미기재' },
    { kind: 'tabular_text', encoding: 'windows-949-compatible', encodingEvidence: { ambiguous: true, candidates: ['cp949', 'euc-kr'] }, table: { rows: [['한빛상회', '40300']] } },
    { kind: 'tabular_text', encoding: 'utf-8', table: { rows: [['새봄상사', '정산, 확인', '25000']] } },
  ];
  return {
    inputRecords: fixtures.map((item) => ({ ...item, afterSha256: item.sha256 })),
    turns: TEXT_TABULAR_TURNS.map((turn, index) => ({
      id: turn.id, runStatus: 'completed',
      answer: index === 0 ? '한빛상회_CP949.csv 40,300원, 새봄상사_UTF8_BOM.csv 25,000원, 근무_메모_UTF16.txt 4.5시간이며 휴게는 미기재입니다.'
        : '한빛상회 40,300원, 새봄상사 25,000원, 합계 65,300원입니다. 근무시간 4.5시간은 있으나 휴게 포함 여부는 미기재라 실근무시간은 확인이 필요합니다.',
      receipts: index === 0 ? observations.map((observation, receiptIndex) => ({
        requestedCall: { name: 'attachment', args: { action: 'inspect', attachmentId: `id-${receiptIndex}` } },
        outcome: 'succeeded', result: { observation },
      })) : [],
    })),
  };
}

test('인코딩 과업은 같은 목적의 고정·일상 표현을 가진다', () => {
  assert.deepEqual(TEXT_TABULAR_TURNS.map((turn) => turn.id), ['inspect-encoded-files', 'reconcile-exact-result']);
  assert.deepEqual(TEXT_TABULAR_CASUAL_TURNS.map((turn) => turn.id), TEXT_TABULAR_TURNS.map((turn) => turn.id));
  assert.notEqual(TEXT_TABULAR_CASUAL_TURNS[0].prompt(), TEXT_TABULAR_TURNS[0].prompt());
});

test('fixture bytes와 hash는 결정적이고 세 인코딩 현실을 가진다', () => {
  const first = createTextTabularFixtureBytes(); const second = createTextTabularFixtureBytes();
  assert.deepEqual(first.map((item) => item.sha256), second.map((item) => item.sha256));
  assert.deepEqual(first.map((item) => item.fileName), [
    '근무_메모_UTF16.txt', '한빛상회_CP949.csv', '새봄상사_UTF8_BOM.csv',
  ]);
});

test('세 실제 관측·금액·합계·휴게 미확인의 논리곱만 통과한다', () => {
  assert.equal(assessTextTabularQualification(passingInput()).passed, true);
  const equivalent = passingInput();
  equivalent.turns[1].answer = '한빛상회 40,300원, 새봄상사 25,000원, 합계 65,300원, 근무시간 4.5시간, 아직 미확정: 휴게시간 포함 여부';
  assert.equal(assessTextTabularQualification(equivalent).passed, true);
  for (const mutate of [
    (input) => { input.turns[0].receipts.shift(); },
    (input) => { input.turns[1].answer = input.turns[1].answer.replace('65,300', '62,000'); },
    (input) => { input.turns[1].answer = '한빛상회 40,300원, 새봄상사 25,000원, 합계 65,300원이며 근무시간은 4.5시간이고 휴게는 0분입니다.'; },
    (input) => { input.inputRecords[0].afterSha256 = 'changed'; },
  ]) {
    const input = passingInput(); mutate(input);
    assert.equal(assessTextTabularQualification(input).passed, false);
  }
});
