const COMMIT = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

function sourceError(message) {
  return Object.assign(new Error(message), { code: 'T5_RELEASE_SOURCE_NOT_REPRODUCIBLE' });
}

export function assertReleaseSourcePolicy({ sourceCommit, sourceDirty, signing } = {}) {
  if (!COMMIT.test(String(sourceCommit ?? ''))) {
    throw sourceError('release source commit is not exact');
  }
  if (typeof sourceDirty !== 'boolean') throw sourceError('release source dirty state is unknown');
  if (signing === 'developer-id' && sourceDirty) {
    throw sourceError('signed release requires clean packaged inputs');
  }
  if (!['developer-id', 'unsigned'].includes(signing)) {
    throw sourceError('release signing mode is invalid');
  }
  return Object.freeze({
    sourceCommit: String(sourceCommit), sourceDirty,
    signing, developmentOnly: signing === 'unsigned',
    releaseEligible: signing === 'developer-id' && sourceDirty === false,
  });
}

export function assertNotarySourceBoundary({ manifest, packageSha256 } = {}) {
  if (manifest?.schema !== 't5.macos-team-installer.v1'
    || manifest.sourceScope !== 'packaged-inputs'
    || manifest.signing !== 'developer-id'
    || manifest.sourceDirty !== false
    || manifest.developmentOnly === true
    || manifest.releaseEligible !== true
    || !COMMIT.test(String(manifest.sourceCommit ?? ''))
    || !SHA256.test(String(packageSha256 ?? ''))
    || manifest.package?.sha256 !== packageSha256) {
    throw sourceError('notarization requires a clean exact-commit signed package manifest');
  }
  return true;
}
