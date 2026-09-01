import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const SHA256 = /^[a-f0-9]{64}$/u;

async function digestFile(path) { const digest = createHash('sha256'); await new Promise((resolve, reject) => {
  const stream = createReadStream(path); stream.on('data', (chunk) => digest.update(chunk));
  stream.once('error', reject); stream.once('end', resolve); }); return digest.digest('hex'); }

function silenceWav(seconds = 1) {
  const rate = 16_000; const data = Buffer.alloc(rate * seconds * 2); const output = Buffer.alloc(44 + data.length);
  output.write('RIFF', 0); output.writeUInt32LE(36 + data.length, 4); output.write('WAVEfmt ', 8);
  output.writeUInt32LE(16, 16); output.writeUInt16LE(1, 20); output.writeUInt16LE(1, 22);
  output.writeUInt32LE(rate, 24); output.writeUInt32LE(rate * 2, 28); output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34); output.write('data', 36); output.writeUInt32LE(data.length, 40);
  data.copy(output, 44); return output;
}

async function exactFile(path, expectedSha256 = null) {
  const exact = await realpath(path); const info = await lstat(exact);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error('Whisper qualification file is unsafe');
  const sha256 = await digestFile(exact);
  if (expectedSha256 && expectedSha256 !== sha256) throw new Error('Whisper qualification file identity changed');
  return { path: exact, bytes: info.size, sha256 };
}

function validOutput(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && value.model && typeof value.model === 'object' && Array.isArray(value.transcription)
    && value.transcription.length <= 64 && value.transcription.every((segment) => (
      typeof segment?.text === 'string' && segment.text.length <= 10_000
      && Number.isFinite(segment?.offsets?.from) && Number.isFinite(segment?.offsets?.to)
    ));
}

export function makeWhisperHostQualifier({ helper, expectedHelperSha256 = null, run = execute } = {}) {
  if (!helper || (expectedHelperSha256 != null && !SHA256.test(expectedHelperSha256))) {
    throw new TypeError('Whisper host qualification inputs are required');
  }
  return async function qualify({ path: modelPath, asset, scratchRoot, signal = null } = {}) {
    if (!SHA256.test(asset?.sha256 ?? '')) throw new TypeError('Whisper model asset is required');
    const [host, model] = await Promise.all([
      exactFile(helper, expectedHelperSha256), exactFile(modelPath, asset.sha256),
    ]);
    const root = await realpath(scratchRoot); const rootInfo = await lstat(root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('Whisper qualification scratch is unsafe');
    const directory = await mkdtemp(join(root, 't5-whisper-qualification-'));
    try {
      const version = await run(host.path, ['--version'], { timeout: 10_000, maxBuffer: 8 * 1024,
        ...(signal ? { signal } : {}), env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C' } });
      if (!`${version.stdout ?? ''}\n${version.stderr ?? ''}`.trim()) throw new Error('Whisper host version is unavailable');
      const audio = join(directory, 'silence.wav'); const output = join(directory, 'result');
      await writeFile(audio, silenceWav(), { mode: 0o600 });
      await run(host.path, ['-m', model.path, '-f', audio, '-l', 'en', '-ojf', '-of', output, '--no-prints'], {
        timeout: 120_000, maxBuffer: 256 * 1024, ...(signal ? { signal } : {}),
        env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C' },
      });
      const resultBytes = await readFile(`${output}.json`);
      if (resultBytes.length > 512 * 1024) throw new Error('Whisper qualification output is too large');
      const result = JSON.parse(resultBytes.toString('utf8'));
      if (!validOutput(result)) throw new Error('Whisper qualification output is invalid');
      const receiptDigest = createHash('sha256').update(JSON.stringify({
        helperSha256: host.sha256, helperBytes: host.bytes, modelSha256: model.sha256,
        modelBytes: model.bytes, schemaObserved: true, segmentCount: result.transcription.length,
      })).digest('hex');
      return { qualified: true, receiptDigest, helperSha256: host.sha256,
        modelSha256: model.sha256, segmentCount: result.transcription.length };
    } finally { await rm(directory, { recursive: true, force: true }); }
  };
}
