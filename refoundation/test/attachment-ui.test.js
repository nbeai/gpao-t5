import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('기존 콘솔 입력은 다중 파일 선택·드래그앤드롭·첨부 chip을 한 표면에서 제공한다', async () => {
  const html = await readFile(resolve(root, 'src/surface/web/index.html'), 'utf8');
  assert.match(html, /id="attach"[^>]*aria-label="파일 첨부"/);
  assert.match(html, /id="filepick"[^>]*type="file"[^>]*multiple/);
  assert.match(html, /uploadFiles\(e\.dataTransfer\?\.files/);
  assert.match(html, /stagedAttachments/);
  assert.match(html, /attachmentIds:\s*sentAttachments\.map/);
  assert.match(html, /renderMessageAttachments\(box, e\.attachments\)/);
});

test('모델이 등록한 결과 artifact는 파일명·크기·다운로드 링크로 렌더된다', async () => {
  const html = await readFile(resolve(root, 'src/surface/web/index.html'), 'utf8');
  assert.match(html, /function renderArtifacts/);
  assert.match(html, /card\.href = record\.downloadUrl/);
  assert.match(html, /card\.download = record\.originalName/);
  assert.match(html, /renderArtifacts\(box, r\.artifacts\)/);
});
