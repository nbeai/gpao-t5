import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm,
} from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/u;
const LANGUAGE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]+)*$/u;
const DEFAULT_MAX_CHARS = 20_000;
const MAX_CHARS = 64_000;
const DEFAULT_MAX_CAPTION_BYTES = 2 * 1024 * 1024;
const MAX_PROCESS_OUTPUT = 4 * 1024 * 1024;
const MAX_STDERR = 32 * 1024;

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

export function youtubeVideoIdentity(rawUrl) {
  let parsed;
  try { parsed = new URL(String(rawUrl ?? '').trim()); }
  catch { throw new TypeError('invalid YouTube video URL'); }
  if (parsed.protocol !== 'https:') throw new TypeError('YouTube video URL must use HTTPS');
  if (parsed.username || parsed.password) throw new TypeError('YouTube URL credentials are not allowed');
  const host = parsed.hostname.toLowerCase().replace(/^www\./u, '');
  let videoId = null; let contentType = 'video';
  if (host === 'youtu.be') videoId = parsed.pathname.split('/').filter(Boolean)[0] ?? null;
  else if (host === 'youtube.com' || host === 'm.youtube.com') {
    if (parsed.pathname === '/watch') videoId = parsed.searchParams.get('v');
    else if (parsed.pathname.startsWith('/shorts/')) {
      videoId = parsed.pathname.split('/').filter(Boolean)[1] ?? null; contentType = 'short_video';
    }
  }
  if (!VIDEO_ID.test(videoId ?? '')) throw new TypeError('exact YouTube video URL is required');
  return {
    platform: 'youtube', contentType, videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

function defaultRunProcess({ path, args, cwd, signal, timeoutMs = 60_000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(path, args, {
      cwd, signal, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', NO_COLOR: '1' },
    });
    let stdout = ''; let stderr = ''; let stdoutBytes = 0; let stderrBytes = 0; let settled = false;
    const finish = (error, value) => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_PROCESS_OUTPUT) { child.kill(); finish(new Error('caption source output is too large')); return; }
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= MAX_STDERR) stderr += chunk;
    });
    child.once('error', (error) => finish(error));
    child.once('close', (code) => finish(null, { code, stdout, stderr, stderrTruncated: stderrBytes > MAX_STDERR }));
    const timer = setTimeout(() => { child.kill(); finish(new Error('caption source timed out')); }, timeoutMs);
  });
}

async function ensureSafeRoot(root) {
  try { if ((await lstat(root)).isSymbolicLink()) throw new Error('caption root must not be a symlink'); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
  await mkdir(root, { recursive: true, mode: 0o700 }); await chmod(root, 0o700);
}

function trackObjects(stdout) {
  const rows = String(stdout ?? '').split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (rows.length < 2) throw new Error('caption track response is invalid');
  let manual; let automatic;
  const parse = (row) => row === 'NA' ? {} : JSON.parse(row);
  try { manual = parse(rows[0]); automatic = parse(rows[1]); }
  catch { throw new Error('caption track response is invalid'); }
  if (!manual || Array.isArray(manual) || typeof manual !== 'object'
    || !automatic || Array.isArray(automatic) || typeof automatic !== 'object') {
    throw new Error('caption track response is invalid');
  }
  return { manual, automatic };
}

function matchingLanguage(keys, requested) {
  const lower = requested.toLowerCase();
  return keys.find((key) => key.toLowerCase() === lower)
    ?? keys.find((key) => key.toLowerCase() === lower.split('-')[0])
    ?? keys.find((key) => key.toLowerCase().startsWith(`${lower.split('-')[0]}-`))
    ?? null;
}

function chooseTrack(manual, automatic, requested) {
  const manualKeys = Object.keys(manual).sort(); const automaticKeys = Object.keys(automatic).sort();
  if (requested) {
    const exactManual = matchingLanguage(manualKeys, requested);
    if (exactManual) return { source: 'manual', language: exactManual };
    const exactAutomatic = matchingLanguage(automaticKeys, requested);
    return exactAutomatic ? { source: 'automatic', language: exactAutomatic } : null;
  }
  const manualEnglish = matchingLanguage(manualKeys, 'en');
  if (manualEnglish) return { source: 'manual', language: manualEnglish };
  if (manualKeys[0]) return { source: 'manual', language: manualKeys[0] };
  const automaticEnglish = automaticKeys.includes('en-orig') ? 'en-orig' : matchingLanguage(automaticKeys, 'en');
  if (automaticEnglish) return { source: 'automatic', language: automaticEnglish };
  return automaticKeys[0] ? { source: 'automatic', language: automaticKeys[0] } : null;
}

function timestamp(milliseconds) {
  const total = Math.max(0, Math.floor(Number(milliseconds ?? 0) / 1000));
  const hours = String(Math.floor(total / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const seconds = String(total % 60).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function captionText(json, maxChars) {
  if (!Array.isArray(json?.events)) throw new Error('caption JSON3 is invalid');
  const cues = [];
  for (const event of json.events) {
    const value = Array.isArray(event?.segs)
      ? event.segs.map((segment) => String(segment?.utf8 ?? '')).join('').replace(/\s+/gu, ' ').trim() : '';
    if (value) cues.push(`[${timestamp(event.tStartMs)}] ${value}`);
  }
  const complete = cues.join('\n'); const shown = complete.slice(0, maxChars);
  return {
    events: json.events.length, cues: cues.length,
    text: {
      text: shown, totalChars: complete.length, shownChars: shown.length,
      truncated: complete.length > shown.length, omittedChars: Math.max(0, complete.length - shown.length),
      trust: 'untrusted_external', instructionAuthority: 'none',
    },
  };
}

function executionFacts(stderr = '') {
  return {
    mediaDownloaded: false, cookiesUsed: false, userConfigIgnored: true,
    javascriptRuntime: 'bundled_node',
    javascriptRuntimeMissing: /No supported JavaScript runtime/iu.test(stderr),
  };
}

export function makeYouTubeCaptionTool({
  store, root, runProcess = defaultRunProcess, maxCaptionBytes = DEFAULT_MAX_CAPTION_BYTES,
  javascriptRuntime = process.execPath,
} = {}) {
  if (!store || !root || typeof runProcess !== 'function') throw new TypeError('YouTube caption tool inputs are required');
  if (!isAbsolute(javascriptRuntime)) throw new TypeError('exact bundled JavaScript runtime path is required');
  return {
    name: 'video_text',
    description: 'Read bounded public YouTube caption text through a restricted managed source. It never uses user config, cookies, login, playlists, media download, audio, frames, OCR, or arbitrary yt-dlp arguments. Manual captions are preferred for the requested language; automatic captions are fallback only.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['status', 'read'] },
        url: { type: ['string', 'null'] },
        language: { type: ['string', 'null'], maxLength: 24 },
        maxChars: { type: ['integer', 'null'], minimum: 500, maximum: MAX_CHARS },
      },
      required: ['action', 'url', 'language', 'maxChars'],
    },
    async execute(args = {}, context = {}) {
      const status = await store.status('yt-dlp');
      if (args.action === 'status') return status;
      if (args.action !== 'read') throw new TypeError('unsupported video text action');
      const identity = youtubeVideoIdentity(args.url);
      const language = args.language == null ? null : String(args.language).trim();
      if (language != null && !LANGUAGE.test(language)) throw new TypeError('invalid caption language');
      const maxChars = args.maxChars == null ? DEFAULT_MAX_CHARS : Number(args.maxChars);
      if (!Number.isInteger(maxChars) || maxChars < 500 || maxChars > MAX_CHARS) throw new TypeError('invalid caption text limit');
      if (status.state !== 'installed') return {
        state: 'not_prepared', video: identity,
        requiredCapability: { kind: 'cli', id: 'yt-dlp', toolSurface: 'video_text' },
        observed: ['identity'], missing: ['captionTrack', 'captionText', 'audio', 'frames', 'ocr'],
      };
      await ensureSafeRoot(root);
      const work = await mkdtemp(join(root, 'caption-')); await chmod(work, 0o700);
      const binary = store.binaryPath('yt-dlp');
      const baseArgs = [
        '--ignore-config', '--no-playlist', '--skip-download',
        '--js-runtimes', `node:${javascriptRuntime}`,
      ];
      try {
        const probe = await runProcess({
          path: binary, cwd: work, signal: context.signal,
          args: [...baseArgs, '--print', '%(subtitles)j', '--print', '%(automatic_captions)j', identity.canonicalUrl],
        });
        if (probe?.code !== 0) return {
          state: 'source_failed', video: identity, reason: 'caption_track_probe_failed',
          ...executionFacts(probe?.stderr), observed: ['identity'], missing: ['captionTrack', 'captionText', 'audio', 'frames', 'ocr'],
        };
        const { manual, automatic } = trackObjects(probe.stdout);
        const availableLanguages = [...new Set([...Object.keys(manual), ...Object.keys(automatic)])].sort();
        if (availableLanguages.length === 0) return {
          state: 'caption_absent', video: identity, availableLanguages: [],
          ...executionFacts(probe.stderr), observed: ['identity'], missing: ['captionTrack', 'captionText', 'audio', 'frames', 'ocr'],
        };
        const selected = chooseTrack(manual, automatic, language);
        if (!selected) return {
          state: 'language_unavailable', video: identity,
          requestedLanguage: language, availableLanguages: availableLanguages.slice(0, 50),
          availableLanguageCount: availableLanguages.length,
          ...executionFacts(probe.stderr), observed: ['identity', 'captionTrack'], missing: ['captionText', 'audio', 'frames', 'ocr'],
        };
        const writeFlag = selected.source === 'manual' ? '--write-subs' : '--write-auto-subs';
        const fetched = await runProcess({
          path: binary, cwd: work, signal: context.signal,
          args: [
            ...baseArgs, '--no-overwrites', writeFlag, '--sub-langs', selected.language,
            '--sub-format', 'json3', '--output', join(work, '%(id)s.%(ext)s'), identity.canonicalUrl,
          ],
        });
        if (fetched?.code !== 0) throw new Error('caption source fetch failed');
        const entries = await readdir(work, { withFileTypes: true });
        if (entries.length !== 1 || !entries[0].isFile() || !entries[0].name.startsWith(`${identity.videoId}.`)
          || !entries[0].name.endsWith('.json3')) throw new Error('unexpected caption source output');
        const path = join(work, entries[0].name); const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink()) throw new Error('caption output must be a regular file');
        if (info.size > maxCaptionBytes) throw new Error('caption output is too large');
        const bytes = await readFile(path);
        let parsed; try { parsed = JSON.parse(bytes.toString('utf8')); }
        catch { throw new Error('caption JSON3 is invalid'); }
        const content = captionText(parsed, maxChars); const revision = await store.activeRevision('yt-dlp');
        return {
          state: content.cues ? 'caption_read' : 'caption_empty', video: identity,
          caption: {
            source: selected.source, language: selected.language, format: 'json3',
            bytes: bytes.length, sha256: sha256(bytes), events: content.events, cues: content.cues,
            text: content.text,
          },
          capability: { kind: 'cli', id: 'yt-dlp', version: revision.version, digest: revision.digest },
          execution: executionFacts(`${probe.stderr ?? ''}\n${fetched.stderr ?? ''}`),
          observed: content.cues ? ['identity', 'captionTrack', 'captionText'] : ['identity', 'captionTrack'],
          missing: content.cues ? ['audio', 'frames', 'ocr'] : ['captionText', 'audio', 'frames', 'ocr'],
        };
      } finally { await rm(work, { recursive: true, force: true }); }
    },
  };
}
