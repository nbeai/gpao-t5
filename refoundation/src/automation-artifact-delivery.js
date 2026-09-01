function exactIdentity(record, expected) {
  const identity = record?.providerIdentity;
  return identity?.kind === 'automation_result_delivery'
    && identity.jobId === expected.jobId
    && identity.automationRunId === expected.automationRunId
    && identity.sourceRunId === expected.sourceRunId
    && identity.sourceSessionId === expected.sourceSessionId
    && identity.sourceAttachmentId === expected.sourceAttachmentId
    && identity.sourceSha256 === expected.sourceSha256
    && identity.sourceBytes === expected.sourceBytes;
}

export async function deliverAutomationArtifacts({ attachmentStore, sourceSessionId,
  destinationSessionId, sourceArtifacts = [], jobId, automationRunId, sourceRunId } = {}) {
  if (!attachmentStore || typeof attachmentStore.readContent !== 'function'
    || typeof attachmentStore.receive !== 'function' || typeof attachmentStore.list !== 'function') {
    throw new TypeError('canonical attachment store is required');
  }
  if (!String(sourceSessionId ?? '').trim() || !String(destinationSessionId ?? '').trim()
    || !String(jobId ?? '').trim() || !String(automationRunId ?? '').trim()
    || !String(sourceRunId ?? '').trim()) throw new TypeError('automation artifact delivery identity is required');
  if (!Array.isArray(sourceArtifacts) || sourceArtifacts.length > 10) {
    throw new TypeError('automation artifacts are invalid');
  }
  const destinationRecords = await attachmentStore.list({ sessionId: destinationSessionId });
  const delivered = [];
  for (const artifact of sourceArtifacts) {
    const sourceAttachmentId = String(artifact?.attachmentId ?? '').trim();
    if (!sourceAttachmentId) throw new TypeError('automation source artifact is invalid');
    const source = await attachmentStore.readContent({ sessionId: sourceSessionId,
      attachmentId: sourceAttachmentId });
    if (source.record.direction !== 'output' || source.record.sha256 !== artifact.sha256
      || source.record.bytes !== artifact.bytes || source.bytes.length !== source.record.bytes) {
      throw new Error('automation source artifact identity changed');
    }
    const identity = {
      kind: 'automation_result_delivery', jobId: String(jobId),
      automationRunId: String(automationRunId), sourceRunId: String(sourceRunId),
      sourceSessionId: String(sourceSessionId), sourceAttachmentId,
      sourceSha256: source.record.sha256, sourceBytes: source.record.bytes,
    };
    const matches = destinationRecords.filter((record) => exactIdentity(record, identity));
    if (matches.length > 1) throw new Error('automation artifact delivery identity is ambiguous');
    let destination = matches[0] ?? null;
    if (destination) {
      const reopened = await attachmentStore.readContent({ sessionId: destinationSessionId,
        attachmentId: destination.attachmentId });
      if (reopened.record.direction !== 'output' || reopened.record.sha256 !== source.record.sha256
        || reopened.record.bytes !== source.record.bytes || reopened.bytes.length !== source.bytes.length) {
        throw new Error('automation delivered artifact identity changed');
      }
      destination = reopened.record;
    } else {
      destination = await attachmentStore.receive({ sessionId: destinationSessionId,
        originalName: source.record.originalName, declaredMime: source.record.mimeType,
        bytes: source.bytes, direction: 'output', providerIdentity: identity });
    }
    delivered.push(destination);
  }
  return delivered;
}
