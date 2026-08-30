import { randomUUID } from 'node:crypto';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';

export function documentPublicationTemporary(target, {
  env = process.env, makeId = randomUUID,
} = {}) {
  const confinedRoot = env.T5_DOCUMENT_CONFINED === '1'
    && isAbsolute(String(env.TMPDIR ?? '')) ? resolve(env.TMPDIR) : null;
  const parent = confinedRoot ?? dirname(target);
  const extension = extname(target) || '.tmp';
  return join(parent, `.t5-document-${makeId()}${extension}`);
}
