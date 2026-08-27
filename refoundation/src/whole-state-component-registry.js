import { lstat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { streamFileFacts } from './stream-file-facts.js';

const ID = /^[a-z][a-z0-9-]{1,63}$/u;
const FORBIDDEN_SECRET_LEAVES = new Set([
  'model-connection.json', 'messenger-credentials.json', 'credentials.json', 'secrets.json',
]);

function portablePath(value) {
  const path = String(value ?? '').replaceAll('\\', '/');
  if (!path || isAbsolute(path) || path.startsWith('../') || path.includes('/../') || path.includes('\0')) {
    throw new TypeError('whole-state component path must be portable and relative');
  }
  if (FORBIDDEN_SECRET_LEAVES.has(path.split('/').at(-1))) {
    throw Object.assign(new Error('secret-bearing state cannot enter whole-state backup'), {
      code: 'T5_BACKUP_SECRET_PATH_FORBIDDEN',
    });
  }
  return path;
}

function inside(root, path) {
  const rel = relative(root, path);
  return rel && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel);
}

export class WholeStateComponentRegistry {
  constructor(stateRoot) {
    if (!stateRoot) throw new TypeError('whole-state state root is required');
    this.stateRoot = resolve(stateRoot); this.components = new Map(); this.paths = new Set();
  }
  register({ id, files, required = true, restoreOrder, relationships = [],
    maxFileBytes = null, maxTotalBytes = null, allowLargeExclusion = false, capture = 'file' } = {}) {
    const componentId = String(id ?? '');
    if (!ID.test(componentId) || this.components.has(componentId)) throw new TypeError('whole-state component id is invalid');
    if (!Array.isArray(files) || (required === true && !files.length)) throw new TypeError('whole-state component files are required');
    const paths = files.map(portablePath);
    if (paths.some((path) => this.paths.has(path))) throw new TypeError('whole-state component path is already registered');
    if (!Number.isSafeInteger(restoreOrder) || restoreOrder < 0) throw new TypeError('whole-state restore order is invalid');
    if (maxFileBytes != null && (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1)) {
      throw new TypeError('whole-state component file limit is invalid');
    }
    if (maxTotalBytes != null && (!Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < 1)) {
      throw new TypeError('whole-state component total limit is invalid');
    }
    if (!Array.isArray(relationships) || relationships.some((item) => !ID.test(String(item)))) {
      throw new TypeError('whole-state relationships are invalid');
    }
    if (!['file', 'sqlite_online', 'attachment_portable'].includes(capture)) throw new TypeError('whole-state capture kind is invalid');
    const component = { id: componentId, files: paths, required: required === true,
      restoreOrder, relationships: [...new Set(relationships.map(String))].sort(),
      maxFileBytes, maxTotalBytes, allowLargeExclusion: allowLargeExclusion === true, capture };
    this.components.set(componentId, component); paths.forEach((path) => this.paths.add(path));
    return structuredClone(component);
  }
  async manifest({ generationId, createdAt } = {}) {
    if (!/^[0-9a-f-]{36}$/iu.test(String(generationId ?? ''))) throw new TypeError('backup generation id is invalid');
    const canonicalCreatedAt = new Date(createdAt);
    if (!Number.isFinite(canonicalCreatedAt.getTime()) || canonicalCreatedAt.toISOString() !== createdAt) {
      throw new TypeError('backup generation time is invalid');
    }
    for (const component of this.components.values()) {
      for (const dependencyId of component.relationships) {
        const dependency = this.components.get(dependencyId);
        if (!dependency || dependency.restoreOrder >= component.restoreOrder) {
          throw new TypeError('whole-state restore relationship is invalid');
        }
      }
    }
    const components = [];
    for (const component of [...this.components.values()].sort((a, b) => a.restoreOrder - b.restoreOrder)) {
      const files = []; let missing = 0; let excluded = 0; let includedBytes = 0;
      for (const path of component.files) {
        const exact = resolve(this.stateRoot, path);
        if (!inside(this.stateRoot, exact)) throw new Error('whole-state component escaped state root');
        try {
          const metadata = await lstat(exact);
          if (!metadata.isFile() || metadata.nlink !== 1) throw new Error('whole-state component file is not an exact regular file');
          if ((component.maxFileBytes != null && metadata.size > component.maxFileBytes)
            || (component.maxTotalBytes != null && includedBytes + metadata.size > component.maxTotalBytes)) {
            if (!component.allowLargeExclusion) throw Object.assign(new Error('whole-state component file is too large'), {
              code: 'T5_BACKUP_COMPONENT_FILE_TOO_LARGE', componentId: component.id,
            });
            const facts = await streamFileFacts(exact);
            excluded += 1; files.push({ path, state: 'excluded_large', bytes: facts.bytes,
              sha256: facts.sha256 }); continue;
          }
          const facts = await streamFileFacts(exact); includedBytes += facts.bytes;
          files.push({ path, bytes: facts.bytes, sha256: facts.sha256 });
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
          missing += 1; files.push({ path, state: 'unavailable' });
        }
      }
      if (component.required && missing) throw Object.assign(new Error('required whole-state component is unavailable'), {
        code: 'T5_BACKUP_REQUIRED_COMPONENT_UNAVAILABLE', componentId: component.id,
      });
      components.push({ id: component.id, restoreOrder: component.restoreOrder,
        relationships: component.relationships, capture: component.capture,
        state: missing === files.length ? 'unavailable'
          : excluded === files.length ? 'excluded_large' : missing || excluded ? 'partial' : 'included', files });
    }
    return { schema: 't5.whole-state-generation-manifest.v1', generationId: String(generationId),
      createdAt, sourceRootIncluded: false, secretPlaintextIncluded: false, components };
  }
}
