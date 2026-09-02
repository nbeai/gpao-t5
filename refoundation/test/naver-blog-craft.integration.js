import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { DEFAULT_AGENT_BROWSER_BINARY, makeAgentBrowserDriver } from '../src/agent-browser-driver.js';
import { makeNaverBlogCraftAdapter } from '../src/naver-blog-craft-adapter.js';
import { makePersistentBrowserHost } from '../src/persistent-browser-host.js';

async function fixture() {
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (req.url === '/preview') { res.end('<h1>미리보기</h1><p>사용자의 목적을 실제 결과로 이어줍니다.</p>'); return; }
    res.end(`<!doctype html><meta charset="utf-8"><button aria-label="굵게" onclick="document.execCommand('bold')">굵게</button>
      <button aria-label="구분선" onclick="document.querySelector('[contenteditable]').append(document.createElement('hr'))">구분선</button>
      <button aria-label="줄 간격" onclick="document.querySelector('[contenteditable]').style.lineHeight='2'">줄 간격</button>
      <button aria-label="미리보기" onclick="window.open('/preview','_blank')">미리보기</button>
      <div contenteditable="true">사용자의 목적을 실제 결과로 이어줍니다.</div>
      <input type="file" multiple><figure><figcaption contenteditable="true" aria-label="캡션"></figcaption></figure>
      <script>document.querySelector('input').addEventListener('change',e=>{for(const f of e.target.files){const i=new Image();i.alt=f.name;i.src=URL.createObjectURL(f);document.querySelector('figure').prepend(i)}})</script>`);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { url: `http://127.0.0.1:${server.address().port}/editor`,
    close: () => new Promise((resolve) => server.close(resolve)) };
}

test('Naver Blog craft adapter는 exact DOM text·file input·Preview를 좌표 없이 관측한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-naver-blog-craft-')); const site = await fixture();
  const image = join(room, 'fixture.png'); await writeFile(image, Buffer.from('fixture-image'));
  const host = makePersistentBrowserHost({ root: room, namespace: `t5-naver-craft-${Date.now()}`,
    binary: DEFAULT_AGENT_BROWSER_BINARY, headed: false,
    activateWindow: async () => ({ visible: false, application: null }) });
  const driver = makeAgentBrowserDriver({ ownerId: 'craft', outputDirectory: join(room, 'artifacts'), browserHost: host });
  const adapter = makeNaverBlogCraftAdapter({ browserHost: host });
  try {
    const opened = await driver.navigate(site.url); const targetId = opened.tab.targetId;
    const bold = await adapter.applyFormat({ targetId, targetText: '사용자의 목적', occurrence: 0, kind: 'bold' });
    assert.equal(bold.state, 'verified');
    const spacing = await adapter.applyFormat({ targetId, targetText: '실제 결과', occurrence: 0, kind: 'spacing' });
    assert.equal(spacing.state, 'verified');
    const images = await adapter.insertImages({ targetId, files: [image], captions: ['테스트 이미지'] });
    assert.equal(images.state, 'verified'); assert.equal(images.captionsApplied, 1);
    const preview = await adapter.preview({ targetId });
    assert.equal(preview.state, 'observed'); assert.match(preview.url, /\/preview$/u);
  } finally {
    await adapter.close().catch(() => {}); await driver.close().catch(() => {}); await host.close().catch(() => {});
    await site.close(); await rm(room, { recursive: true, force: true });
  }
});
