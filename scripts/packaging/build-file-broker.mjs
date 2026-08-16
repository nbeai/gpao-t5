import { execFileSync } from 'node:child_process';
import { chmod, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Build only into an already-isolated package staging tree. Never writes into source. */
export async function buildMacFileBroker(packageRoot) {
  if (process.platform !== 'darwin') throw new Error('native file broker package build requires macOS');
  const source = join(packageRoot, 'src', 'native', 'file-broker', 'file-broker.c');
  const outputDir = join(packageRoot, 'src', 'native', 'file-broker', 'bin', 'darwin-arm64');
  const output = join(outputDir, 't5-file-broker');
  await mkdir(outputDir, { recursive: true });
  execFileSync('xcrun', [
    'clang', '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror',
    '-target', 'arm64-apple-macos13', source, '-o', output,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  await chmod(output, 0o755);
  return output;
}
