import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDocxFromSpec } from '../src/docx-deliverable.js';

function spec() {
  return {
    title: '상담 후속 조치', paragraphs: [{ text: '2026-08-23 상담 결과입니다.' }],
    tables: [{
      columns: [{ key: 'kind', header: '구분', width: 1 }, { key: 'content', header: '내용', width: 2 }, { key: 'status', header: '상태', width: 1 }],
      rows: [{ kind: '담당자', content: '홍길동', status: '확인' }, { kind: '비용', content: '최종 비용', status: '확인 필요' }],
    }],
  };
}

test('bounded DOCX spec은 deterministic OOXML을 쓰고 즉시 본문·표를 재개방한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-docx-create-')); const output = join(room, '결과.docx');
  const result = await createDocxFromSpec({ output, spec: spec() });
  assert.equal(result.created, true); assert.equal(result.observation.state, 'observed');
  assert.match(result.observation.text, /상담 후속 조치/u); assert.match(result.observation.text, /홍길동/u);
  assert.equal(result.observation.structure.tables.length, 1);
  assert.deepEqual(result.observation.structure.tables[0].cells[0].map((cell) => cell.text), ['구분', '내용', '상태']);
  assert.ok((await readFile(output)).length > 0);
  await assert.rejects(() => createDocxFromSpec({ output, spec: spec() }), /explicit replace/u);
});

test('DOCX spec은 빈 제목·중복 column·과대 구조를 파일 생성 전에 거부한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-docx-invalid-'));
  await assert.rejects(() => createDocxFromSpec({ output: join(room, 'a.docx'), spec: { title: '' } }), /title/u);
  const duplicated = spec(); duplicated.tables[0].columns[1].key = 'kind';
  await assert.rejects(() => createDocxFromSpec({ output: join(room, 'b.docx'), spec: duplicated }), /duplicated/u);
});
