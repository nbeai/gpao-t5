import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const read = (path) => readFile(resolve(root, path), 'utf8');

test('GPAO-T5 원저작권과 비공개 package metadata는 YOON·UNLICENSED로 한 벌이다', async () => {
  const [copyright, notice, readme, rootPackage, refoundationPackage, lock] = await Promise.all([
    read('COPYRIGHT'), read('NOTICE'), read('README.md'),
    read('package.json').then(JSON.parse),
    read('refoundation/package.json').then(JSON.parse),
    read('refoundation/package-lock.json').then(JSON.parse),
  ]);
  assert.match(copyright, /Copyright © 2026 YOON\. All rights reserved\./);
  assert.match(copyright, /Third-party components are excluded/);
  assert.match(notice, /private and unpublished/);
  assert.match(notice, /does not grant a\s+public software license/);
  assert.match(readme, /Copyright © 2026 YOON/);
  for (const pkg of [rootPackage, refoundationPackage]) {
    assert.equal(pkg.private, true);
    assert.equal(pkg.author, 'YOON');
    assert.equal(pkg.license, 'UNLICENSED');
  }
  assert.equal(lock.packages[''].license, 'UNLICENSED');
});

test('lock에 든 모든 제3자 package의 exact version·license가 notices에 빠짐없이 있다', async () => {
  const [notices, lock] = await Promise.all([
    read('THIRD_PARTY_NOTICES.md'),
    read('refoundation/package-lock.json').then(JSON.parse),
  ]);
  const packages = Object.entries(lock.packages).filter(([path]) => path);
  assert.equal(packages.length, 55);
  for (const [path, metadata] of packages) {
    const name = path.replace(/^node_modules\//, '');
    assert.ok(metadata.version, `${name} version missing`);
    assert.ok(metadata.license, `${name} license missing`);
    const row = `| \`${name}\` | ${metadata.version} | ${metadata.license} |`;
    assert.ok(notices.includes(row), `${name} notice row missing`);
  }
  assert.match(notices, /not a replacement for any third-party\s+license text/);
});

test('직접 포함한 dependency마다 배포 시 보존할 원문 license 파일이 설치본에 있다', async () => {
  const pkg = JSON.parse(await read('refoundation/package.json'));
  for (const name of Object.keys(pkg.dependencies)) {
    const directory = resolve(root, 'refoundation', 'node_modules', name);
    const files = await readdir(directory);
    const license = files.find((file) => /^(?:license|copying)(?:\.|$)/i.test(file));
    assert.ok(license, `${name} license file missing`);
    await access(join(directory, license));
  }
});
