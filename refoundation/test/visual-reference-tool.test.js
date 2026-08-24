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
    assert.ok(result.previews.every((row) => row.stages.map((stage) => stage.stage).join(',')
      === 'candidate,fetch,qualification,attachment'));
    assert.equal((await attachments.list({ sessionId: SESSION })).length, 3);
    const again = await tool.execute({ query: 'another wording', limit: 3, domains: null });
    assert.equal(again.state, 'already_satisfied'); assert.equal(again.stopFurtherResearch, true);
    assert.equal((await attachments.list({ sessionId: SESSION })).length, 3);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('읽히지 않은 source의 search image도 포함해 세 preview를 만들고 단계별 영수증을 남긴다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-visual-reference-search-images-'));
  try {
    const attachments = new AttachmentStore(join(room, 'attachments'));
    const researchTool = { async execute() { return {
      state: 'researched', query: 'editorial', candidateCount: 5, readableCount: 1,
      sources: [{ title: 'only readable', candidateUrl: 'https://one.example/' }],
      selectedPreviewMetadata: [1, 2, 3].map((rank) => ({
        title: `Image ${rank}`, candidateUrl: `https://site${rank}.example/`,
        sourceUrl: `https://site${rank}.example/`, images: [{
          url: `https://img.example/${rank}.jpg`, provenance: 'search_provider_result', providerField: 'image_url',
        }],
      })),
    }; } };
    let serial = 0;
    const tool = makeVisualReferenceTool({
      researchTool, attachments, sessionId: SESSION,
      resolveHost: async () => ['93.184.216.34'],
      fetchImpl: async () => {
        serial += 1;
        return new Response(Buffer.concat([PNG, Buffer.from([serial])]), {
          status: 200, headers: { 'content-type': 'image/png', 'content-length': String(PNG.length + 1) },
        });
      },
    });
    const result = await tool.execute({ query: 'editorial', limit: 3, domains: null });
    assert.equal(result.state, 'previewed'); assert.equal(result.previews.length, 3);
    assert.equal(result.verificationMissing, false);
    assert.ok(result.previews.every((row) => row.previewProvenance === 'search_provider_result'));
    assert.deepEqual(result.previews[0].stages.map((stage) => stage.stage), [
      'candidate', 'fetch', 'qualification', 'attachment',
    ]);
    assert.equal(result.previews[0].stages[2].mimeType, 'image/png');
    assert.ok(result.previews[0].stages[2].bytes > 0);
    assert.ok(result.previews[0].stages[3].attachmentId);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('preview metadata가 0이면 빈 성공 대신 failure code와 verificationMissing을 반환한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-visual-reference-zero-metadata-'));
  try {
    const attachments = new AttachmentStore(join(room, 'attachments'));
    const researchTool = { async execute() { return {
      state: 'researched', query: 'plain pages', candidateCount: 3, readableCount: 3,
      sources: [], selectedPreviewMetadata: [1, 2, 3].map((rank) => ({
        title: `Plain ${rank}`, candidateUrl: `https://plain${rank}.example/`,
        sourceUrl: `https://plain${rank}.example/`, images: [],
      })),
    }; } };
    const tool = makeVisualReferenceTool({ researchTool, attachments, sessionId: SESSION });
    const result = await tool.execute({ query: 'plain pages', limit: 3, domains: null });
    assert.equal(result.state, 'no_previews'); assert.equal(result.previews.length, 0);
    assert.equal(result.failures.length, 3);
    assert.ok(result.failures.every((row) => row.failureCode === 'preview_metadata_missing'));
    assert.equal(result.verificationMissing, true);
    assert.equal(result.stopFurtherResearch, false);
    assert.equal(result.completedCapabilityGroups, undefined);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('이미지라고 선언된 비이미지 bytes는 attachment 전에 qualification failure로 보존한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-visual-reference-invalid-image-'));
  try {
    const attachments = new AttachmentStore(join(room, 'attachments'));
    const researchTool = { async execute() { return {
      state: 'researched', query: 'invalid', candidateCount: 1, readableCount: 1,
      selectedPreviewMetadata: [{
        title: 'Invalid', candidateUrl: 'https://page.example/', sourceUrl: 'https://page.example/',
        images: [{ url: 'https://img.example/not-really.png', provenance: 'search_provider_result' }],
      }],
    }; } };
    const tool = makeVisualReferenceTool({
      researchTool, attachments, sessionId: SESSION,
      resolveHost: async () => ['93.184.216.34'],
      fetchImpl: async () => new Response(Buffer.from('not an image'), {
        status: 200, headers: { 'content-type': 'image/png' },
      }),
    });
    const result = await tool.execute({ query: 'invalid', limit: 3, domains: null });
    assert.equal(result.state, 'no_previews'); assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].failureCode, 'invalid_image_bytes');
    assert.equal(result.failures[0].failedStage, 'qualification');
    assert.equal((await attachments.list({ sessionId: SESSION })).length, 0);
    assert.equal(result.verificationMissing, true);
  } finally { await rm(room, { recursive: true, force: true }); }
});
