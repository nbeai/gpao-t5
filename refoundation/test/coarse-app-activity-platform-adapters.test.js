import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { normalizeCoarseAppSegment } from '../src/coarse-app-activity-platform-adapters.js';

test('macOS helper는 frontmost identity·AFK만 읽고 title·URL·content API를 쓰지 않는다',async()=>{
  const source=await readFile(new URL('../native/macos-coarse-app-activity.m',import.meta.url),'utf8');
  assert.match(source,/frontmostApplication/u);assert.match(source,/CGEventSourceSecondsSinceLastEventType/u);
  assert.match(source,/bundleIdentifier/u);assert.match(source,/durationMs/u);
  assert.doesNotMatch(source,/windowTitle|localizedTitle|CGWindow|kCGWindowName|URL|clipboard|pasteboard|keylog|AXUIElement/u);
});

test('macOS·Windows adapter는 같은 closed segment를 쓰고 host 밖 PASS를 만들지 않는다',async()=>{
  const source=await readFile(new URL('../src/coarse-app-activity-platform-adapters.js',import.meta.url),'utf8');
  assert.match(source,/process\.platform!==platform/u);assert.match(source,/macos_workspace/u);assert.match(source,/windows_foreground/u);
  const base={kind:'segment',segmentId:'s',appId:'com.app',appLabel:'앱',startedAt:'2026-08-27T00:00:00.000Z',
    endedAt:'2026-08-27T00:00:01.000Z',durationMs:1000,afk:'active'};
  assert.equal(normalizeCoarseAppSegment(base).workBinding,null);
  assert.equal(normalizeCoarseAppSegment({...base,windowTitle:'private'}),null);
  assert.equal(normalizeCoarseAppSegment({...base,url:'https://private'}),null);
});
