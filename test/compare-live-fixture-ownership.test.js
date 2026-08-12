import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  chmodOwned, cleanupOwned, createOwned,
} from '../scripts/compare-live/fixture-ownership.mjs';
import { prepareUserView } from '../scripts/compare-live/user-view.mjs';

test('비교 fixture: 생성한 같은 파일만 지우고 교체된 사용자 파일은 보존한다', () => {
  const root = mkdtempSync(join(tmpdir(), 't5-fixture-owner-'));
  try {
    const records = createOwned(
      root,
      { 'owned.txt': 'runner fixture\n' },
      join(root, 'anchors'),
    );
    const path = join(root, 'owned.txt');

    unlinkSync(path);
    writeFileSync(path, 'user replacement\n');

    assert.equal(chmodOwned(records[0], 0o000), false);
    const result = cleanupOwned(records, join(root, 'snapshots'));
    assert.deepEqual(result.removed, []);
    assert.equal(result.preserved.length, 1);
    assert.equal(result.outcomes[0].reason, 'identity_replaced_untouched');
    assert.equal(readFileSync(path, 'utf8'), 'user replacement\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('비교 fixture: 생성 신분과 내용이 그대로면 스냅샷 뒤 정리한다', () => {
  const root = mkdtempSync(join(tmpdir(), 't5-fixture-owner-'));
  try {
    const records = createOwned(
      root,
      { 'owned.txt': 'runner fixture\n' },
      join(root, 'anchors'),
    );
    const path = join(root, 'owned.txt');

    assert.equal(chmodOwned(records[0], 0o000), true);
    assert.equal(chmodOwned(records[0], 0o644), true);
    const result = cleanupOwned(records, join(root, 'snapshots'));
    assert.deepEqual(result.removed, [path]);
    assert.deepEqual(result.preserved, []);
    assert.equal(result.outcomes[0].reason, 'fixture_unchanged');
    assert.equal(existsSync(path), false);
    assert.equal(readFileSync(join(root, 'snapshots', 'owned.txt'), 'utf8'), 'runner fixture\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('비교 fixture: 제품이 내용을 바꾸면 회차 무효가 아니라 변경 증거로 보존한다', () => {
  const root = mkdtempSync(join(tmpdir(), 't5-fixture-owner-'));
  try {
    const records = createOwned(
      root,
      { 'owned.txt': 'runner fixture\n' },
      join(root, 'anchors'),
    );
    const path = join(root, 'owned.txt');
    writeFileSync(path, 'product changed fixture\n');

    const result = cleanupOwned(records, join(root, 'snapshots'));
    assert.deepEqual(result.removed, [path]);
    assert.deepEqual(result.preserved, []);
    assert.equal(result.outcomes[0].reason, 'content_modified_by_product');
    assert.equal(
      readFileSync(join(root, 'snapshots', 'owned.txt'), 'utf8'),
      'product changed fixture\n',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('비교 fixture: 생성 기록이 없으면 기존 증거 폴더에 아무것도 만들지 않는다', () => {
  const root = mkdtempSync(join(tmpdir(), 't5-fixture-owner-'));
  try {
    const snapshots = join(root, 'existing-run', 'fixtures-final');
    const result = cleanupOwned([], snapshots);
    assert.deepEqual(result, { removed: [], preserved: [], outcomes: [] });
    assert.equal(existsSync(snapshots), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('비교 사용자 시야: 자격 HOME은 격리하고 Downloads·Developer만 실제 폴더로 연결한다', () => {
  const root = mkdtempSync(join(tmpdir(), 't5-user-view-'));
  try {
    const userHome = join(root, 'user');
    const isolatedHome = join(root, 'isolated');
    mkdirSync(join(userHome, 'Downloads'), { recursive: true });
    mkdirSync(join(userHome, 'Developer'), { recursive: true });

    const links = prepareUserView(isolatedHome, userHome);

    assert.equal(realpathSync(links.Downloads.link), realpathSync(join(userHome, 'Downloads')));
    assert.equal(realpathSync(links.Developer.link), realpathSync(join(userHome, 'Developer')));
    assert.notEqual(isolatedHome, userHome);
    assert.equal(existsSync(join(isolatedHome, '.hermes')), false);
    assert.equal(existsSync(join(isolatedHome, '.openclaw')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
