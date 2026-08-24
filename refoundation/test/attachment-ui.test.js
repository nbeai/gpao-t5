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
  assert.match(html, /startTurn\(submittedSessionId, t, sentAttachments\.map/);
  assert.match(html, /renderMessageAttachments\(box, e\.attachments\)/);
});

test('모델이 등록한 결과물은 preview를 먼저 보여주고 크게 보기·파일 받기·원문 보기를 제공한다', async () => {
  const html = await readFile(resolve(root, 'src/surface/web/index.html'), 'utf8');
  assert.match(html, /function renderArtifacts/);
  assert.match(html, /record\.previewUrl/);
  assert.match(html, /artifact-preview/);
  assert.match(html, /openArtifactDetail\(record, 'preview'\)/);
  assert.match(html, /크게 보기/);
  assert.match(html, /파일 받기/);
  assert.match(html, /record\.sourceUrl/);
  assert.match(html, /원문 보기/);
  assert.match(html, /실행 기록/);
  assert.match(html, /t5-artifact-log/);
  assert.match(html, /record\.versionsUrl/);
  assert.match(html, /버전/);
  assert.match(html, /preview\.setAttribute\('sandbox'/);
  assert.match(html, /record\.previewKind !== 'pdf'/);
  assert.match(html, /renderArtifacts\(box, r\.artifacts\)/);
});

test('결과물 크게 보기는 대화와 분리된 modal에 preview·코드·웹앱 파일목록을 연다', async () => {
  const html = await readFile(resolve(root, 'src/surface/web/index.html'), 'utf8');
  assert.match(html, /function openArtifactDetail/);
  assert.match(html, /dialog\.showModal\(\)/);
  assert.match(html, /record\.previewKind === 'web_app'/);
  assert.match(html, /manifest\.files/);
  assert.match(html, /artifact-source/);
});
