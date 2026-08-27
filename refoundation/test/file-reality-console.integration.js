import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';

import { makeConsoleServer } from '../src/console-server.js';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test('실제 콘솔은 모호한 단서로 컴퓨터 후보를 찾고 선택한 파일만 다시 연다', async (t) => {
  const room = await mkdtemp(join(tmpdir(), 't5-file-reality-console-'));
  const workspace = join(room, 'workspace'); const archive = join(room, 'archive'); const organized = join(room, '정리예정');
  await Promise.all([mkdir(workspace), mkdir(archive), mkdir(organized)]);
  const target = join(archive, '기억안나는자료.txt');
  await writeFile(target, '한빛상사 여름 행사 견적 478만원\n파란 포장으로 확정\n');
  let turn = 0; const visible = []; const errors = [];
  const server = makeConsoleServer({
    stateDir: join(room, 'state'), workspace, computerFileRoots: [room],
    fileIndexSearch: async () => [target], onError: (error) => errors.push(error?.stack ?? String(error)),
    modelFactory: () => ({ async respond(input) {
      turn += 1; visible.push(input.tools.map((tool) => tool.name));
      if (turn === 1) return { text: '', toolCalls: [{ id: 'discover-files', name: 'tool_search', args: {
        query: '컴퓨터 전체 파일 찾기 이름 위치 모름 내용 단서 중복 최종본 버전',
      } }] };
      if (turn === 2) return { text: '', toolCalls: [{ id: 'search-files', name: 'file_reality', args: {
        action: 'search', query: '한빛상사 파란 포장 478만원', scope: 'computer', path: null,
        handles: null, maxCandidates: 5, placements: null,
      } }] };
      if (turn === 3) {
        const observed = JSON.parse(input.messages.findLast((item) => item.role === 'tool').content).result;
        assert.equal(observed.contentIncluded, false);
        assert.equal(observed.candidates[0].displayName, '기억안나는자료.txt', JSON.stringify(observed.candidates));
        return { text: '', toolCalls: [{ id: 'inspect-file', name: 'file_reality', args: {
          action: 'inspect', query: null, scope: null, path: null,
          handles: [observed.candidates[0].handle], maxCandidates: null, placements: null,
        } }] };
      }
      if (turn === 4) {
        const inspected = JSON.parse(input.messages.findLast((item) => item.role === 'tool').content).result;
        assert.match(inspected.content ?? '', /한빛상사 여름 행사 견적 478만원/u, JSON.stringify(inspected));
        return { text: '', toolCalls: [{ id: 'plan-file', name: 'file_reality', args: {
          action: 'plan', query: null, scope: null, path: null, handles: null, maxCandidates: null,
          placements: [{ handle: inspected.file.handle, destinationDirectory: organized }],
        } }] };
      }
      if (turn === 5) {
        const planned = JSON.parse(input.messages.findLast((item) => item.role === 'tool').content).result;
        assert.equal(planned.readyToApply, true); assert.equal(planned.filesChanged, 0);
        return { text: '', toolCalls: [{ id: 'complete-file-search', name: 'work_completion',
          args: { outcome: 'achieved', inputSettlements: [] } }] };
      }
      return { text: '한빛상사 여름 행사 견적 478만원 자료를 찾았습니다.', toolCalls: [] };
    } }),
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  });
  const base = await listen(server);
  const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
  const response = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: session.id, text: '이름은 기억 안 나는데 한빛상사 파란 포장 478만원 견적 파일 찾아줘' }) });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify({ result, errors }));
  assert.match(result.reply, /478만원 자료를 찾았습니다/u);
  assert.equal(visible[0].includes('file_reality'), false);
  assert.equal(visible[1].includes('file_reality'), true);
  assert.equal(errors.length, 0, errors.join('\n'));
});

test('실제 콘솔은 무의미한 이미지 파일명에서 local OCR 금액·업체 단서를 찾는다', async (t) => {
  const room = await mkdtemp(join(tmpdir(), 't5-file-ocr-console-')); const desktop = join(room, 'Desktop');
  const workspace = join(room, 'workspace'); await Promise.all([mkdir(desktop), mkdir(workspace)]);
  const image = join(desktop, 'KakaoTalk_20260827_193010.png'); await writeFile(image, 'fixture-image');
  let call = 0; let probes = 0; const errors = [];
  const server = makeConsoleServer({ stateDir: join(room, 'state'), workspace, computerFileRoots: [desktop],
    fileIndexSearch: async () => [], fileOcrProbe: async () => { probes += 1; return { state: 'observed',
      width: 1200, height: 1600, observations: [{ text: '한빛상사 견적 금액 4,780,000원', confidence: 0.98 }],
      text: '한빛상사 견적 금액 4,780,000원', truncated: false, engine: 'macos-vision-local' }; },
    onError: (error) => errors.push(error?.stack ?? String(error)), modelFactory: () => ({ async respond(input) {
      call += 1;
      if (call === 1) { assert.equal(input.tools.some((tool) => tool.name === 'file_search'), true);
        return { text: '', toolCalls: [{ id: 'ocr-search', name: 'file_search', args: {
          action: 'search', query: '한빛상사 478만원 견적', scope: 'computer', path: null,
          handles: null, maxCandidates: 5 } }] }; }
      if (call === 2) { const found = JSON.parse(input.messages.findLast((item) => item.role === 'tool').content).result;
        assert.equal(found.candidates[0].displayName, 'KakaoTalk_20260827_193010.png');
        assert.match(found.candidates[0].evidence.ocrExcerpt, /4,780,000원/u);
        return { text: '', toolCalls: [{ id: 'complete-ocr', name: 'work_completion', args: { outcome: 'achieved', inputSettlements: [] } }] }; }
      return { text: '바탕화면에서 한빛상사 478만원 견적 사진을 찾았습니다.', toolCalls: [] };
    } }) });
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true }); });
  const base = await listen(server); const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
  const response = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: session.id, text: '바탕화면에서 카카오로 받은 한빛상사 478만원 견적 사진 찾아줘' }) });
  const result = await response.json(); assert.equal(response.status, 200, JSON.stringify({ result, errors }));
  assert.match(result.reply, /478만원 견적 사진/u); assert.equal(probes, 1); assert.equal(errors.length, 0, errors.join('\n'));
});

test('실제 콘솔은 바탕화면의 무의미한 파일명 사진을 bounded contact sheet로 판별한다', async (t) => {
  const room = await mkdtemp(join(tmpdir(), 't5-passport-photo-console-')); const desktop = join(room, 'Desktop');
  const workspace = join(room, 'workspace'); await Promise.all([mkdir(desktop), mkdir(workspace)]);
  const svg = (body) => Buffer.from(`<svg width="300" height="400" xmlns="http://www.w3.org/2000/svg"><rect width="300" height="400" fill="#eee"/>${body}</svg>`);
  await writeFile(join(desktop, 'KakaoTalk_a.png'), await sharp(svg('<rect x="40" y="60" width="220" height="260" fill="#55a"/>')).png().toBuffer());
  await writeFile(join(desktop, 'KakaoTalk_b.png'), await sharp(svg('<rect width="300" height="400" fill="white"/><ellipse cx="150" cy="150" rx="70" ry="90" fill="#e8b98e"/><path d="M80 130 Q150 30 220 130" fill="#222"/><path d="M55 400 Q70 260 150 260 Q230 260 245 400" fill="#333"/>')).png().toBuffer());
  await writeFile(join(desktop, 'KakaoTalk_c.png'), await sharp(svg('<circle cx="150" cy="200" r="110" fill="#5a5"/>')).png().toBuffer());
  let call = 0; const errors = []; const args = (extra) => ({ query: null, scope: null, path: null, handles: null,
    maxCandidates: null, placements: null, planId: null, effect: null, sourceUses: null, purpose: null,
    unknowns: null, standardization: null, ...extra });
  const server = makeConsoleServer({ stateDir: join(room, 'state'), workspace, computerFileRoots: [desktop],
    fileOcrProbe: async () => ({ state: 'observed', observations: [], text: '' }),
    onError: (error) => errors.push(error?.stack ?? String(error)), modelFactory: () => ({ async respond(input) {
      call += 1;
      if (call === 1) return { text: '', toolCalls: [{ id: 'find-visual-hand', name: 'tool_search', args: { query: '폴더 사진 시각 후보 contact sheet 찾기' } }] };
      if (call === 2) return { text: '', toolCalls: [{ id: 'image-candidates', name: 'file_reality', args: args({ action: 'image_candidates', scope: 'path', path: desktop, maxCandidates: 12 }) }] };
      if (call === 3) { const found = JSON.parse(input.messages.findLast((item) => item.role === 'tool').content).result;
        return { text: '', toolCalls: [{ id: 'visual-candidates', name: 'file_reality', args: args({ action: 'visual_candidates', handles: found.candidates.map((item) => item.handle) }) }] }; }
      if (call === 4) { assert.equal(input.messages.at(-1).modelAttachments.length, 1);
        const observed = JSON.parse(input.messages.at(-2).content).result; assert.equal(observed.candidates[1].displayName, 'KakaoTalk_b.png');
        return { text: '', toolCalls: [{ id: 'complete-visual', name: 'work_completion', args: { outcome: 'achieved', inputSettlements: [] } }] }; }
      return { text: '바탕화면에서 여권사진 후보 KakaoTalk_b.png를 찾았습니다.', toolCalls: [] };
    } }) });
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true }); });
  const base = await listen(server); const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
  const response = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: session.id, text: '바탕화면에서 여권사진 찾아줘' }) });
  const result = await response.json(); assert.equal(response.status, 200, JSON.stringify({ result, errors }));
  assert.match(result.reply, /KakaoTalk_b\.png/u); assert.equal(errors.length, 0, errors.join('\n'));
});
