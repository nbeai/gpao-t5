import test from 'node:test';
import assert from 'node:assert/strict';

import { makeGoogleDriveApi } from '../src/google-drive-api.js';

test('Drive 검색은 사용자 검색어를 API q 문법으로 이스케이프하고 공유 드라이브·불완전 결과를 보존한다', async () => {
  let requested;
  const api = makeGoogleDriveApi({
    credential: async () => ({ accessToken: 'ACCESS' }),
    fetchImpl: async (url, options) => {
      requested = { url: new URL(url), options };
      return new Response(JSON.stringify({
        nextPageToken: 'NEXT', incompleteSearch: true,
        files: [{ id: 'file-1', name: "대표's 자료", mimeType: 'application/pdf', modifiedTime: '2026-08-20T00:00:00Z' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const result = await api.search({ query: "대표's \\ 자료", pageSize: 20, pageToken: null });
  assert.equal(requested.url.origin, 'https://www.googleapis.com');
  assert.match(requested.url.searchParams.get('q'), /trashed = false/u);
  assert.match(requested.url.searchParams.get('q'), /대표\\'s \\\\ 자료/u);
  assert.equal(requested.url.searchParams.get('supportsAllDrives'), 'true');
  assert.equal(requested.url.searchParams.get('includeItemsFromAllDrives'), 'true');
  assert.equal(requested.options.headers.authorization, 'Bearer ACCESS');
  assert.equal(result.incompleteSearch, true);
  assert.equal(result.nextPageToken, 'NEXT');
  assert.equal(result.files[0].id, 'file-1');
});

test('blob 파일은 alt=media로 받고 Google 문서는 검증된 형식으로 export한다', async () => {
  const calls = [];
  const metadata = new Map([
    ['blob', { id: 'blob', name: 'invoice.pdf', mimeType: 'application/pdf', capabilities: { canDownload: true } }],
    ['sheet', { id: 'sheet', name: '정산표', mimeType: 'application/vnd.google-apps.spreadsheet', capabilities: { canDownload: true } }],
  ]);
  const api = makeGoogleDriveApi({
    credential: async () => ({ accessToken: 'ACCESS' }),
    fetchImpl: async (url) => {
      const parsed = new URL(url); calls.push(parsed);
      const id = decodeURIComponent(parsed.pathname.split('/').at(-1));
      if (!parsed.searchParams.has('alt') && !parsed.pathname.endsWith('/export')) {
        return new Response(JSON.stringify(metadata.get(id)), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(id === 'blob' ? 'PDF-BYTES' : 'XLSX-BYTES', {
        status: 200, headers: { 'content-type': id === 'blob' ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      });
    },
  });
  const blob = await api.download({ fileId: 'blob', exportMime: null });
  assert.equal(blob.originalName, 'invoice.pdf');
  assert.equal(blob.bytes.toString(), 'PDF-BYTES');
  assert.equal(calls.some((url) => url.searchParams.get('alt') === 'media'), true);
  const sheet = await api.download({ fileId: 'sheet', exportMime: null });
  assert.equal(sheet.originalName, '정산표.xlsx');
  assert.equal(sheet.bytes.toString(), 'XLSX-BYTES');
  assert.equal(calls.some((url) => url.pathname.endsWith('/export')
    && url.searchParams.get('mimeType').includes('spreadsheetml')), true);
});

test('다운로드 권한이 없거나 지원하지 않는 Google 문서 형식은 바이트를 받기 전에 멈춘다', async () => {
  let contentCalls = 0;
  const api = makeGoogleDriveApi({
    credential: async () => ({ accessToken: 'ACCESS' }),
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      if (parsed.searchParams.has('alt') || parsed.pathname.endsWith('/export')) contentCalls += 1;
      return new Response(JSON.stringify({
        id: 'blocked', name: 'blocked', mimeType: 'application/vnd.google-apps.form',
        capabilities: { canDownload: false },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  await assert.rejects(() => api.download({ fileId: 'blocked', exportMime: null }), /download is not allowed/u);
  assert.equal(contentCalls, 0);
});

test('폴더 생성·multipart 업로드·blob 교체는 API 응답 file identity를 반환한다', async () => {
  const calls = [];
  const api = makeGoogleDriveApi({
    credential: async () => ({ accessToken: 'ACCESS' }),
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method, body: options.body, headers: options.headers });
      if (String(url).includes('/files/blob-file?fields=')) return new Response(JSON.stringify({
        id: 'blob-file', name: 'old.txt', mimeType: 'text/plain', capabilities: { canEdit: true },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({
        id: calls.length === 1 ? 'folder-1' : calls.length === 2 ? 'upload-1' : 'blob-file',
        name: calls.length === 1 ? '거래처' : calls.length === 2 ? 'report.txt' : 'old.txt',
        mimeType: calls.length === 1 ? 'application/vnd.google-apps.folder' : 'text/plain',
        modifiedTime: '2026-08-20T00:00:00Z',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal((await api.createFolder({ name: '거래처', parentId: null })).id, 'folder-1');
  assert.equal((await api.upload({ name: 'report.txt', mimeType: 'text/plain', bytes: Buffer.from('hello'), parentId: 'folder-1' })).id, 'upload-1');
  assert.equal((await api.replace({ fileId: 'blob-file', mimeType: 'text/plain', bytes: Buffer.from('updated') })).id, 'blob-file');
  assert.equal(calls[0].method, 'POST');
  assert.match(String(calls[1].headers['content-type']), /multipart\/related/u);
  assert.equal(calls.at(-1).method, 'PATCH');
});

test('Google native 문서 본문 교체는 Drive API로 성공한 척하지 않는다', async () => {
  let patchCalls = 0;
  const api = makeGoogleDriveApi({
    credential: async () => ({ accessToken: 'ACCESS' }),
    fetchImpl: async (url, options = {}) => {
      if (options.method === 'PATCH') patchCalls += 1;
      return new Response(JSON.stringify({
        id: 'doc', name: '문서', mimeType: 'application/vnd.google-apps.document', capabilities: { canEdit: true },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  await assert.rejects(() => api.replace({
    fileId: 'doc', mimeType: 'text/plain', bytes: Buffer.from('replacement'),
  }), /specialized Google Workspace API/u);
  assert.equal(patchCalls, 0);
});

test('파일 이름 수정은 편집 가능성을 먼저 확인하고 PATCH 뒤 새 메타데이터를 반환한다', async () => {
  const calls = [];
  const api = makeGoogleDriveApi({
    credential: async () => ({ accessToken: 'ACCESS' }),
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (!options.method) return new Response(JSON.stringify({
        id: 'rename-me', name: 'before.txt', mimeType: 'text/plain', capabilities: { canEdit: true },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({
        id: 'rename-me', name: 'after.txt', mimeType: 'text/plain', capabilities: { canEdit: true },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const renamed = await api.rename({ fileId: 'rename-me', name: 'after.txt' });
  assert.equal(renamed.name, 'after.txt');
  assert.equal(calls[1].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[1].options.body), { name: 'after.txt' });
});

test('Drive API 오류는 access token과 provider 원문을 사용자 오류에 반사하지 않는다', async () => {
  const api = makeGoogleDriveApi({
    credential: async () => ({ accessToken: 'ACCESS-SECRET' }),
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'leaked ACCESS-SECRET' } }), {
      status: 403, headers: { 'content-type': 'application/json' },
    }),
  });
  await assert.rejects(() => api.search({ query: 'x', pageSize: 10, pageToken: null }), (error) => {
    assert.equal(error.status, 403);
    assert.doesNotMatch(error.message, /ACCESS-SECRET|leaked/u);
    return true;
  });
});

test('Drive 읽기의 401은 실제 사용 generation을 갱신해 exact 한 번만 재시도한다', async () => {
  const authorizations = []; const refreshed = [];
  const api = makeGoogleDriveApi({
    credential: async () => ({ accessToken: 'OLD', generation: 7 }),
    onUnauthorized: async ({ failedGeneration }) => {
      refreshed.push(failedGeneration); return { accessToken: 'NEW', generation: 8 };
    },
    fetchImpl: async (_url, options) => {
      authorizations.push(options.headers.authorization);
      if (authorizations.length === 1) return new Response('', { status: 401 });
      return new Response(JSON.stringify({ files: [], incompleteSearch: false }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    },
  });
  await api.search({ query: '계약서', pageSize: 10, pageToken: null });
  assert.deepEqual(refreshed, [7]);
  assert.deepEqual(authorizations, ['Bearer OLD', 'Bearer NEW']);
});
