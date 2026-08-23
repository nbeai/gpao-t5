import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function renderDocxFirstPage(file, {
  platform = process.platform, runCommand = execFileAsync, temporaryRoot = tmpdir(),
} = {}) {
  if (platform !== 'darwin') return { state: 'capability_boundary', reason: 'docx_visual_renderer_not_qualified' };
  const directory = await mkdtemp(join(temporaryRoot, 't5-docx-quicklook-'));
  try {
    await runCommand('/usr/bin/qlmanage', ['-t', '-s', '1600', '-o', directory, file], {
      timeout: 30_000, maxBuffer: 512 * 1024,
      env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'ko_KR.UTF-8' },
    });
    const pages = (await readdir(directory)).filter((name) => /\.png$/iu.test(name));
    if (pages.length !== 1) return { state: 'capability_boundary', reason: 'docx_visual_output_ambiguous' };
    const bytes = await readFile(join(directory, pages[0]));
    if (!bytes.length || bytes.length > 20 * 1024 * 1024) return { state: 'capability_boundary', reason: 'docx_visual_output_limit' };
    return { state: 'rendered', bytes, mimeType: 'image/png', engine: 'macos-quicklook', page: 1 };
  } catch (error) {
    return { state: 'capability_boundary', reason: 'docx_visual_render_failed', error: error?.message ?? String(error) };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
