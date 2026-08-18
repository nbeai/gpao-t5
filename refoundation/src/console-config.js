import { resolve } from 'node:path';

export function resolveConsoleWorkspace(env = process.env, userHome) {
  if (!userHome) throw new TypeError('userHome is required');
  return resolve(env.T5_REFOUNDATION_WORKSPACE ?? userHome);
}
