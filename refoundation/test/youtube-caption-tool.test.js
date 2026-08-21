import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeYouTubeCaptionTool, youtubeVideoIdentity } from '../src/youtube-caption-tool.js';

const video = 'https://www.youtube.com/watch?v=M7lc1UVf-VE';
const installedStore = {
  async status() { return { state: 'installed', activeVersion: '2026.08.19', availableThrough: 'video_text' }; },
  async activeRevision() { return { active: true, version: '2026.08.19', digest: 'a'.repeat(64) }; },
  binaryPath() { return '/managed/private-bin/yt-dlp'; },
};

function json3(texts) {
  return JSON.stringify({ events: texts.map((text, index) => ({
    tStartMs: index * 1000, dDurationMs: 900, segs: [{ utf8: text }],
  })) });
}

test('YouTube watch·youtu.be·Shorts는 같은 stable identity이고 channel·playlist는 영상이 아니다', () => {
  assert.deepEqual(youtubeVideoIdentity(video), {
    platform: 'youtube', contentType: 'video', videoId: 'M7lc1UVf-VE',
    canonicalUrl: 'https://www.youtube.com/watch?v=M7lc1UVf-VE',
  });
  assert.equal(youtubeVideoIdentity('https://youtu.be/M7lc1UVf-VE').videoId, 'M7lc1UVf-VE');
  assert.equal(youtubeVideoIdentity('https://www.youtube.com/shorts/M7lc1UVf-VE').contentType, 'short_video');
  assert.throws(() => youtubeVideoIdentity('https://www.youtube.com/@GoogleDevelopers'), /video URL/u);
  assert.throws(() => youtubeVideoIdentity('https://www.youtube.com/playlist?list=PL123'), /video URL/u);
  assert.throws(() => youtubeVideoIdentity('https://user:secret@youtube.com/watch?v=M7lc1UVf-VE'), /credentials/u);
});

test('준비 전에는 실행하지 않고 필요한 managed capability만 공개한다', async () => {
  let calls = 0;
  const tool = makeYouTubeCaptionTool({
    store: { ...installedStore, async status() { return { state: 'not_installed', activeVersion: null, availableThrough: 'video_text' }; } },
    root: join(tmpdir(), 'unused-youtube-caption'), runProcess: async () => { calls += 1; },
  });
  const result = await tool.execute({ action: 'read', url: video, language: 'en', maxChars: 10_000 });
  assert.equal(result.state, 'not_prepared');
  assert.deepEqual(result.requiredCapability, { kind: 'cli', id: 'yt-dlp', toolSurface: 'video_text' });
  assert.equal(calls, 0);
});

test('manual 자막을 automatic보다 먼저 선택하고 bounded JSON3 사실만 돌려준다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-youtube-caption-manual-'));
  const calls = [];
  try {
    const tool = makeYouTubeCaptionTool({ root: room, store: installedStore, javascriptRuntime: '/runtime/node', runProcess: async ({ path, args, cwd }) => {
      calls.push({ path, args: [...args] });
      if (calls.length === 1) return { code: 0, stdout: `${JSON.stringify({ en: [{ ext: 'json3' }] })}\n${JSON.stringify({ en: [{ ext: 'json3' }], ko: [{ ext: 'json3' }] })}\n`, stderr: '' };
      await writeFile(join(cwd, 'M7lc1UVf-VE.en.json3'), json3(['first line', 'second line']), { mode: 0o600 });
      return { code: 0, stdout: '', stderr: 'No supported JavaScript runtime could be found' };
    } });
    const result = await tool.execute({ action: 'read', url: video, language: 'en', maxChars: 500 });
    assert.equal(result.state, 'caption_read');
    assert.equal(result.caption.source, 'manual'); assert.equal(result.caption.language, 'en');
    assert.equal(result.caption.events, 2); assert.match(result.caption.text.text, /\[00:00:00\] first line/);
    assert.equal(result.execution.mediaDownloaded, false); assert.equal(result.execution.cookiesUsed, false);
    assert.equal(result.execution.userConfigIgnored, true); assert.equal(result.execution.javascriptRuntimeMissing, true);
    assert.equal(result.execution.javascriptRuntime, 'bundled_node');
    assert.deepEqual(result.capability, { kind: 'cli', id: 'yt-dlp', version: '2026.08.19', digest: 'a'.repeat(64) });
    assert.ok(calls[1].args.includes('--write-subs')); assert.ok(!calls[1].args.includes('--write-auto-subs'));
    assert.ok(calls[1].args.includes('--ignore-config')); assert.ok(calls[1].args.includes('--skip-download'));
    assert.ok(calls[1].args.includes('--js-runtimes')); assert.ok(calls[1].args.includes('node:/runtime/node'));
    assert.ok(!calls.flatMap((call) => call.args).some((arg) => /cookie|format|audio|video/i.test(arg) && arg !== '--sub-format'));
    assert.deepEqual(await readdir(room), []);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('요청 언어의 manual이 없을 때만 automatic을 쓰고, 언어가 없으면 다른 언어로 바꾸지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-youtube-caption-auto-'));
  const calls = [];
  try {
    const runProcess = async ({ args, cwd }) => {
      calls.push([...args]);
      if (calls.length % 2 === 1) return { code: 0, stdout: `${JSON.stringify({ en: [{ ext: 'json3' }] })}\n${JSON.stringify({ ko: [{ ext: 'json3' }] })}\n`, stderr: '' };
      await writeFile(join(cwd, 'M7lc1UVf-VE.ko.json3'), json3(['한국어 자동 자막']), { mode: 0o600 });
      return { code: 0, stdout: '', stderr: '' };
    };
    const tool = makeYouTubeCaptionTool({ root: room, store: installedStore, runProcess });
    const korean = await tool.execute({ action: 'read', url: video, language: 'ko', maxChars: 1000 });
    assert.equal(korean.caption.source, 'automatic'); assert.ok(calls[1].includes('--write-auto-subs'));
    const unavailable = await tool.execute({ action: 'read', url: video, language: 'fr', maxChars: 1000 });
    assert.equal(unavailable.state, 'language_unavailable');
    assert.equal(calls.length, 3);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('자막 absent는 파일과 audio 관측 없이 정직하게 멈춘다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-youtube-caption-absent-'));
  let calls = 0;
  try {
    const tool = makeYouTubeCaptionTool({
      root: room, store: installedStore,
      runProcess: async () => (calls += 1, { code: 0, stdout: 'NA\nNA\n', stderr: '' }),
    });
    const result = await tool.execute({ action: 'read', url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', language: null, maxChars: 1000 });
    assert.equal(result.state, 'caption_absent'); assert.equal(calls, 1);
    assert.deepEqual(result.observed, ['identity']);
    assert.ok(result.missing.includes('captionText')); assert.ok(result.missing.includes('audio'));
    assert.deepEqual(await readdir(room), []);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('같은 video·요청 언어·tool digest는 24시간 로컬 cache에서 source 호출 없이 재사용한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-youtube-caption-cache-'));
  const work = join(room, 'work'); const cacheRoot = join(room, 'cache'); let calls = 0;
  try {
    const tool = makeYouTubeCaptionTool({ root: work, cacheRoot, store: installedStore, runProcess: async ({ cwd }) => {
      calls += 1;
      if (calls === 1) return { code: 0, stdout: `${JSON.stringify({ en: [{ ext: 'json3' }] })}\n{}\n`, stderr: '' };
      await writeFile(join(cwd, 'M7lc1UVf-VE.en.json3'), json3(['cached transcript line']), { mode: 0o600 });
      return { code: 0, stdout: '', stderr: '' };
    } });
    const first = await tool.execute({ action: 'read', url: video, language: 'en', maxChars: 1000 });
    assert.equal(first.cache.state, 'stored'); assert.equal(first.sourceInvoked, true); assert.equal(calls, 2);
    const second = await tool.execute({ action: 'read', url: 'https://youtu.be/M7lc1UVf-VE', language: 'en', maxChars: 500 });
    assert.equal(second.cache.state, 'hit'); assert.equal(second.sourceInvoked, false); assert.equal(calls, 2);
    assert.equal(second.video.videoId, first.video.videoId); assert.match(second.caption.text.text, /cached transcript line/);
    const files = await readdir(cacheRoot); assert.equal(files.length, 1);
    assert.equal((await stat(join(cacheRoot, files[0]))).mode & 0o777, 0o600);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('자막 GET의 일시 실패만 부분 파일을 지우고 한 번 재시도하며 영구 실패는 멈춘다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-youtube-caption-retry-'));
  let calls = 0;
  try {
    const tool = makeYouTubeCaptionTool({ root: room, store: installedStore, runProcess: async ({ cwd }) => {
      calls += 1;
      if (calls === 1) return { code: 0, stdout: `${JSON.stringify({ en: [{ ext: 'json3' }] })}\n{}\n`, stderr: '' };
      if (calls === 2) { await writeFile(join(cwd, 'partial.part'), 'partial'); return { code: 1, stdout: '', stderr: 'HTTP Error 503: Service Unavailable' }; }
      await assert.rejects(() => access(join(cwd, 'partial.part')));
      await writeFile(join(cwd, 'M7lc1UVf-VE.en.json3'), json3(['recovered caption']));
      return { code: 0, stdout: '', stderr: '' };
    } });
    assert.equal((await tool.execute({ action: 'read', url: video, language: 'en', maxChars: 1000 })).state, 'caption_read');
    assert.equal(calls, 3);

    const permanent = makeYouTubeCaptionTool({ root: room, store: installedStore, runProcess: async () => {
      calls += 1;
      if (calls === 4) return { code: 0, stdout: `${JSON.stringify({ en: [{ ext: 'json3' }] })}\n{}\n`, stderr: '' };
      return { code: 1, stdout: '', stderr: 'Unsupported subtitle format' };
    } });
    const stopped = await permanent.execute({ action: 'read', url: video, language: 'en', maxChars: 1000 });
    assert.equal(stopped.state, 'source_failed'); assert.equal(stopped.reason, 'caption_fetch_failed');
    assert.equal(calls, 5);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('automatic 자막이 계속 실패하면 manual 대체 언어를 사실로 돌려주고 몰래 전환하지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-youtube-caption-source-switch-'));
  let calls = 0;
  try {
    const tool = makeYouTubeCaptionTool({ root: room, store: installedStore, runProcess: async () => {
      calls += 1;
      if (calls === 1) return {
        code: 0, stdout: `${JSON.stringify({ en: [{ ext: 'json3' }] })}\n${JSON.stringify({ ko: [{ ext: 'json3' }] })}\n`, stderr: '',
      };
      return { code: 1, stdout: '', stderr: 'HTTP Error 503: Service Unavailable' };
    } });
    const result = await tool.execute({ action: 'read', url: video, language: 'ko', maxChars: 1000 });
    assert.equal(result.state, 'source_failed'); assert.equal(result.fetchRetried, true);
    assert.equal(result.failedSource, 'automatic'); assert.equal(result.failedLanguage, 'ko');
    assert.deepEqual(result.availableManualLanguages, ['en']);
    assert.equal(result.caption, undefined); assert.equal(calls, 3);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('과대·추가 media·깨진 JSON3는 결과로 승격하지 않고 temporary를 정리한다', async () => {
  for (const kind of ['large', 'media', 'json']) {
    const room = await mkdtemp(join(tmpdir(), `t5-youtube-caption-${kind}-`));
    try {
      let calls = 0;
      const tool = makeYouTubeCaptionTool({ root: room, store: installedStore, maxCaptionBytes: 64, runProcess: async ({ cwd }) => {
        calls += 1;
        if (calls === 1) return { code: 0, stdout: `${JSON.stringify({ en: [{ ext: 'json3' }] })}\n{}\n`, stderr: '' };
        if (kind === 'large') await writeFile(join(cwd, 'M7lc1UVf-VE.en.json3'), Buffer.alloc(65));
        if (kind === 'media') { await writeFile(join(cwd, 'M7lc1UVf-VE.en.json3'), json3(['ok'])); await writeFile(join(cwd, 'video.mp4'), 'media'); }
        if (kind === 'json') await writeFile(join(cwd, 'M7lc1UVf-VE.en.json3'), '{broken');
        return { code: 0, stdout: '', stderr: '' };
      } });
      await assert.rejects(() => tool.execute({ action: 'read', url: video, language: 'en', maxChars: 1000 }), /caption|JSON3|unexpected/u);
      assert.deepEqual(await readdir(room), []);
      await assert.rejects(() => access(join(room, 'video.mp4')));
    } finally { await rm(room, { recursive: true, force: true }); }
  }
});
