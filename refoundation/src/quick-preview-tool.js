import { EFFECT_SCHEMA } from './exec-tool.js';

const URL_PATTERN = /https:\/\/[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?\.trycloudflare\.com(?:\/)?/giu;

function localOrigin(value) {
  const parsed = new URL(String(value ?? ''));
  if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)
    || !parsed.port || parsed.username || parsed.password) throw new TypeError('quick preview requires an exact localhost HTTP URL with port');
  return parsed.href;
}

function previewUrl(text) {
  const matches = String(text ?? '').match(URL_PATTERN) ?? [];
  return matches.length === 1 ? matches[0].replace(/\/$/u, '') : null;
}

export function makeQuickPreviewTool({ program, processRegistry, ownerId,
  authorizeEffect, fetchImpl = globalThis.fetch, waitMs = 1_000,
} = {}) {
  if (!program || !processRegistry || !ownerId || typeof fetchImpl !== 'function') {
    throw new TypeError('quick preview runtime is incomplete');
  }
  const previews = new Map();
  return {
    name: 'preview_publication', deferred: true, capabilityGroup: 'external_preview',
    searchTerms: ['share local website public preview URL temporary tunnel external demo',
      '로컬 홈페이지 외부 미리보기 주소 임시 터널 공유'],
    description: 'Expose one already-running localhost HTTP project through an installed Cloudflare Quick Tunnel for a temporary public preview. This is a public external transmission for testing only, not production, stable hosting, authentication, or an SLA. No package is installed. Start returns an observed trycloudflare.com URL only after exact reopen; stop ends that preview process.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      action: { type: 'string', enum: ['start', 'status', 'stop'] },
      localUrl: { type: ['string', 'null'] },
      processId: { type: ['string', 'null'] },
      effect: { anyOf: [EFFECT_SCHEMA, { type: 'null' }] },
    }, required: ['action', 'localUrl', 'processId', 'effect'] },
    async execute(args = {}, context = {}) {
      if (args.action === 'start') {
        const origin = localOrigin(args.localUrl);
        if (args.processId != null || args.effect?.kind !== 'external_send'
          || !args.effect.targets?.includes('https://trycloudflare.com')) {
          return { state: 'not_executed', reason: 'quick_preview_external_send_declaration_required' };
        }
        const gate = typeof authorizeEffect === 'function'
          ? await authorizeEffect(args, context) : { allowed: true };
        if (gate?.allowed === false) return { state: gate.result?.state ?? 'approval_required',
          reason: gate.result?.reason ?? null, effect: 'not_executed' };
        let current = await processRegistry.start({ program,
          args: ['tunnel', '--url', origin, '--no-autoupdate'], command: 'cloudflared quick preview',
          cwd: new URL(origin).pathname === '/' ? process.cwd() : process.cwd(), env: {
            PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.T5_REFOUNDATION_HOME ?? process.cwd(),
            NO_COLOR: '1', TUNNEL_METRICS: '127.0.0.1:0',
          }, ownerId, waitMs, metadata: { kind: 'quick_preview', origin, declaredEffect: args.effect },
          onActivity: context.onActivity });
        let url = previewUrl(`${current.stdout}\n${current.stderr}`);
        for (let attempt = 0; !url && attempt < 6 && current.state === 'running'; attempt += 1) {
          current = await processRegistry.poll({ processId: current.processId, ownerId,
            cursor: current.cursor, waitMs: Math.min(waitMs, 3_000) });
          url = previewUrl(`${current.stdout}\n${current.stderr}`);
        }
        if (!url || current.state !== 'running') {
          if (current.processId && current.state === 'running') await processRegistry.stop({
            processId: current.processId, ownerId, reason: 'preview_url_unavailable', cursor: current.cursor });
          return { state: 'preview_failed', reason: url ? 'tunnel_not_running' : 'preview_url_unavailable',
            providerAccepted: Boolean(url), processId: current.processId ?? null };
        }
        let reachable = false; let status = null;
        try { const response = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
          status = response.status; reachable = response.ok; } catch {}
        if (!reachable) { await processRegistry.stop({ processId: current.processId, ownerId,
          reason: 'preview_reopen_failed', cursor: current.cursor });
          return { state: 'preview_failed', reason: 'preview_reopen_failed', providerAccepted: true,
            urlReachable: false, httpStatus: status, processId: current.processId };
        }
        previews.set(current.processId, { url, origin });
        return { state: 'preview_ready', provider: 'cloudflare_quick_tunnel', providerAccepted: true,
          urlReachable: true, httpStatus: status, previewUrl: url, origin, processId: current.processId,
          cursor: current.cursor, publicToAnyoneWithUrl: true, production: false, stableUrl: false,
          billingObserved: false, documentedTier: 'free_quick_tunnel', sla: false,
          limitations: { maxConcurrentRequests: 200, serverSentEvents: false },
          activatedTools: ['browser'] };
      }
      if (!args.processId || args.localUrl != null || args.effect != null) {
        throw new TypeError('quick preview status or stop requires only processId');
      }
      const preview = previews.get(args.processId);
      if (!preview) return { state: 'unavailable', reason: 'preview_process_unknown' };
      if (args.action === 'status') {
        const process = await processRegistry.poll({ processId: args.processId, ownerId,
          cursor: { stdout: 0, stderr: 0 }, waitMs: 0 });
        return { state: process.state === 'running' ? 'preview_ready' : 'preview_stopped',
          previewUrl: preview.url, processId: args.processId, processState: process.state };
      }
      const stopped = await processRegistry.stop({ processId: args.processId, ownerId,
        reason: 'preview_stop', cursor: { stdout: 0, stderr: 0 } });
      previews.delete(args.processId);
      return { state: 'preview_stopped', previewUrl: preview.url, processId: args.processId,
        processState: stopped.state, terminationConfirmed: stopped.terminationConfirmed === true };
    },
  };
}
