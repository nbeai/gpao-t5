import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export function evidenceAdditionCommit(path) {
  const output = execFileSync('git', [
    'log', '--diff-filter=A', '--format=%H', '--', path,
  ], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  if (output.length !== 1) throw new Error(`evidence addition commit is not unique: ${path}`);
  return output[0];
}

export function evidenceRevisionCommit(path) {
  const output = execFileSync('git', [
    'log', '-1', '--format=%H', '--', path,
  ], { encoding: 'utf8' }).trim();
  if (!output) throw new Error(`evidence revision commit is missing: ${path}`);
  return output;
}

export function digestAtCommit(commit, path) {
  const bytes = execFileSync('git', ['show', `${commit}:${path}`], { encoding: 'buffer' });
  return createHash('sha256').update(bytes).digest('hex');
}
