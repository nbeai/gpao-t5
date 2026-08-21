import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AttachmentStore } from '../src/attachment-store.js';
import { makeVisualReferenceTool } from '../src/visual-reference-tool.js';

const SESSION = '11111111-1111-4111-8111-111111111111';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');

test('시각 참고자료는 출처 페이지 대표 이미지를 병렬로 관리 저장해 바로 보이는 preview를 만든다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-visual-reference-'));
  try {
    const attachments = new AttachmentStore(join(room, 'attachments'));
    const researchTool = { async execute() { return {
      state: 'researched', query: 'beige cafe', candidateCount: 4, readableCount: 4,
      sources: Array.from({ length: 4 }, (_, index) => ({
        title: `Reference ${index + 1}`, candidateUrl: `https://site${index}.example/page`,
        source: {
          finalUrl: `https://site${index}.example/page`,
          previewImageUrl: `https://img${index}.example/preview.png`,
        },
      })),
    }; } };
    let active = 0; let peak = 0; let serial = 0;
    const tool = makeVisualReferenceTool({
      researchTool, attachments, sessionId: SESSION,
      resolveHost: async () => ['93.184.216.34'],
      fetchImpl: async () => {
        active += 1; peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 10)); active -= 1;
        serial += 1;
        return new Response(Buffer.concat([PNG, Buffer.from([serial])]), { status: 200, headers: { 'content-type': 'image/png' } });
      },
    });
    const result = await tool.execute({ query: 'beige cafe', limit: 3, domains: null });
    assert.equal(result.state, 'previewed');
    assert.equal(result.previews.length, 3);
    assert.equal(peak, 3);
    assert.ok(result.previews.every((row) => row.previewUrl.includes('/attachments/')));
    assert.ok(result.previews.every((row) => row.previewProvenance === 'source_page_metadata'));
    assert.equal((await attachments.list({ sessionId: SESSION })).length, 3);
    const again = await tool.execute({ query: 'another wording', limit: 3, domains: null });
    assert.equal(again.state, 'already_satisfied'); assert.equal(again.stopFurtherResearch, true);
    assert.equal((await attachments.list({ sessionId: SESSION })).length, 3);
  } finally { await rm(room, { recursive: true, force: true }); }
});
