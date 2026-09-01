function pad(value, width) { return String(Math.max(0, Math.trunc(value))).padStart(width, '0'); }
function timestamp(ms, separator) { const total = Math.max(0, Math.round(ms)); const hours = Math.floor(total / 3600000);
  const minutes = Math.floor(total % 3600000 / 60000); const seconds = Math.floor(total % 60000 / 1000);
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}${separator}${pad(total % 1000, 3)}`; }

function content(transcript, form) { const segments = transcript.transcription;
  if (form === 'txt') return `${segments.map((item) => String(item.text).trim()).filter(Boolean).join('\n')}\n`;
  if (form === 'srt') return `${segments.map((item, index) => `${index + 1}\n${timestamp(item.offsets.from, ',')} --> ${timestamp(item.offsets.to, ',')}\n${String(item.text).trim()}`).join('\n\n')}\n`;
  if (form === 'vtt') return `WEBVTT\n\n${segments.map((item) => `${timestamp(item.offsets.from, '.')} --> ${timestamp(item.offsets.to, '.')}\n${String(item.text).trim()}`).join('\n\n')}\n`;
  throw new TypeError('unsupported transcript artifact form'); }

export function makeTranscriptArtifactAdapter({ attachmentStore } = {}) {
  if (!attachmentStore?.receive || !attachmentStore?.link) throw new TypeError('transcript artifact store is required');
  return { async publish({ sessionId, runId, messageId, result, form, outputName = null,
    revisesAttachmentId = null } = {}) {
    if (result?.state !== 'verified_transcript' || result.publishable !== true
      || result.coverage?.verified !== true || !Array.isArray(result.transcript?.transcription)) {
      throw new Error('only a verified transcript can be published');
    }
    if (!['txt', 'srt', 'vtt'].includes(form)) throw new TypeError('transcript output form is required');
    const bytes = Buffer.from(content(result.transcript, form), 'utf8');
    const artifact = await attachmentStore.receive({ sessionId, direction: 'output',
      originalName: outputName ?? `transcript.${form}`, bytes, revisesAttachmentId,
      providerIdentity: { kind: 'auditory_transcript', operationId: result.operationId,
        sourceSha256: result.source.sha256, coverage: 'verified' } });
    await attachmentStore.link({ sessionId, attachmentIds: [artifact.attachmentId], messageId, runId });
    return { state: 'published', form, artifact, operationId: result.operationId,
      sourceDurationMs: result.source.durationMs, coverage: 'verified' };
  } };
}
