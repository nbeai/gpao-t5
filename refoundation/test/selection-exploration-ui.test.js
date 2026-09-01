import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ui = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');

test('side panel은 main을 줄이지 않는 흰색 overlay와 좁은 창 bottom sheet를 가진다', () => {
  assert.match(ui, /#selectionPanel \{[^}]*background:#fff; color:#24211d/u);
  assert.match(ui, /#selectionPanel \{[^}]*position:fixed; inset:12px 12px 12px auto/u);
  assert.match(ui, /@media \(max-width:720px\)[\s\S]*#selectionPanel \{ inset:auto 8px 8px 8px/u);
  assert.doesNotMatch(ui, /#selectionPanel \{[^}]*flex:none/u);
  assert.match(ui, /여기서는 아직 원래 작업이 바뀌지 않아요/u);
  assert.equal((ui.match(/id="selectionPanel"/gu) ?? []).length, 1);
});

test('persisted message selection만 side open handle과 canonical projection을 사용한다', () => {
  assert.match(ui, /bindSelectionSource\(message, e\.selection\)/u);
  assert.match(ui, /bindSelectionSource\(bot, opts\.selection\)/u);
  assert.match(ui, /messageHandle: selected\.source\.dataset\.selectionMessageHandle/u);
  assert.match(ui, /projectionDigest: selected\.source\.dataset\.selectionProjectionDigest/u);
  assert.match(ui, /startUtf16: selected\.startUtf16, endUtf16: selected\.endUtf16/u);
});

test('side composer는 자체 stream·Stop을 쓰고 main composer와 Work apply를 건드리지 않는다', () => {
  assert.match(ui, /\/selection-explorations\/stream-start/u);
  assert.match(ui, /\/selection-explorations\/stop/u);
  assert.match(ui, /activeSelectionStream/u);
  assert.equal((ui.match(/id="composerStop"/gu) ?? []).length, 1);
  assert.doesNotMatch(ui, /selection-explorations\/apply/u);
  assert.doesNotMatch(ui, /raw reasoning|chain-of-thought/iu);
});
