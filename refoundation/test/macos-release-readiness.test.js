import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('macOS release는 Keychain identity를 기본 사용하고 unsigned는 명시 요청만 허용한다', async () => {
  const build = await readFile(new URL('../scripts/build-macos-installer.mjs', import.meta.url), 'utf8');
  const configuration = await readFile(new URL('../scripts/macos-release-configuration.mjs', import.meta.url), 'utf8');
  assert.match(build, /T5_UNSIGNED_PACKAGE === '1'/u);
  assert.match(build, /assertDeveloperIdentities/u);
  assert.match(configuration, /Developer ID Application: Project Beai Co\.,Ltd/u);
  assert.match(configuration, /Developer ID Installer: Project Beai Co\.,Ltd/u);
  assert.match(configuration, /gpao-t-notary/u);
  assert.doesNotMatch(build + configuration, /AuthKey_|signing-private|BEGIN PRIVATE KEY/u);
});

test('한 release 명령은 preflight→서명 build→payload 검증→공증·staple→재검증을 잇는다', async () => {
  const release = await readFile(new URL('../scripts/release-macos-installer.mjs', import.meta.url), 'utf8');
  const notarize = await readFile(new URL('../scripts/notarize-macos-installer.mjs', import.meta.url), 'utf8');
  assert.match(release, /check-macos-release-readiness/u);
  assert.match(release, /build-macos-installer/u);
  assert.match(release, /verify-macos-installer/u);
  assert.match(release, /notarize-macos-installer/u);
  assert.match(notarize, /notarytool[\s\S]*submit/u);
  assert.match(notarize, /stapler[\s\S]*staple/u);
  assert.match(notarize, /stapler[\s\S]*validate/u);
  assert.match(notarize, /spctl/u);
});

test('signed build와 notarize는 clean exact commit만 받고 unsigned dirty package는 개발용으로만 남긴다', async () => {
  const {
    assertNotarySourceBoundary, assertReleaseSourcePolicy,
  } = await import('../scripts/macos-release-source-boundary.mjs');
  const commit = 'a'.repeat(40); const sha256 = 'b'.repeat(64);
  assert.throws(() => assertReleaseSourcePolicy({
    sourceCommit: commit, sourceDirty: true, signing: 'developer-id',
  }), { code: 'T5_RELEASE_SOURCE_NOT_REPRODUCIBLE' });
  assert.deepEqual(assertReleaseSourcePolicy({
    sourceCommit: commit, sourceDirty: true, signing: 'unsigned',
  }), {
    sourceCommit: commit, sourceDirty: true, signing: 'unsigned',
    developmentOnly: true, releaseEligible: false,
  });
  const manifest = {
    schema: 't5.macos-team-installer.v1', sourceScope: 'packaged-inputs',
    sourceCommit: commit, sourceDirty: false, signing: 'developer-id',
    developmentOnly: false, releaseEligible: true, package: { sha256 },
  };
  assert.equal(assertNotarySourceBoundary({ manifest, packageSha256: sha256 }), true);
  assert.throws(() => assertNotarySourceBoundary({
    manifest: { ...manifest, sourceDirty: true }, packageSha256: sha256,
  }), { code: 'T5_RELEASE_SOURCE_NOT_REPRODUCIBLE' });
  const build = await readFile(new URL('../scripts/build-macos-installer.mjs', import.meta.url), 'utf8');
  assert.ok(build.indexOf('const sourcePolicy = assertReleaseSourcePolicy')
    < build.indexOf('const work = await mkdtemp'));
});
