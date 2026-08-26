const STATUSES = new Set(['passed', 'failed', 'insufficient_sample', 'invalid']);

function validObservation(value) {
  return value && typeof value === 'object'
    && typeof value.passed === 'boolean'
    && typeof value.sourcePresent === 'boolean'
    && typeof value.oracleValid === 'boolean'
    && typeof value.sourceReopened === 'boolean'
    && typeof value.wallMs === 'number' && Number.isFinite(value.wallMs)
    && (value.requestBytes === null || (typeof value.requestBytes === 'number' && Number.isFinite(value.requestBytes)))
    && (value.tokens === null || (typeof value.tokens === 'number' && Number.isFinite(value.tokens)));
}

export function auditRecallCase({ definition, observations = [] } = {}) {
  if (!definition?.id || !['deterministic', 'model'].includes(definition.kind)
    || !definition.sourceId || !definition.oracle || !Array.isArray(observations)
    || observations.some((item) => !validObservation(item))) {
    return { caseId: definition?.id ?? null, lane: definition?.lane ?? null,
      status: 'invalid', failures: null, samples: observations.length, reasons: ['invalid_contract'] };
  }
  if (observations.some((item) => !item.sourcePresent || !item.oracleValid)) {
    return { caseId: definition.id, lane: definition.lane, status: 'invalid', failures: null,
      samples: observations.length, reasons: ['source_or_oracle_missing'] };
  }
  const failures = observations.filter((item) => !item.passed).length;
  let status;
  if (definition.kind === 'deterministic') {
    status = observations.length < 1 ? 'insufficient_sample' : failures >= 1 ? 'failed' : 'passed';
  } else {
    const byModel = new Map();
    for (const item of observations) {
      const values = byModel.get(item.model) ?? []; values.push(item); byModel.set(item.model, values);
    }
    const bothModelsFailed = ['gpt-5.5', 'gpt-5.6-terra'].every((model) => (
      (byModel.get(model) ?? []).some((item) => !item.passed)
    ));
    status = failures >= 2 || bothModelsFailed ? 'failed'
      : observations.length < 3 ? 'insufficient_sample' : 'passed';
  }
  return { caseId: definition.id, lane: definition.lane, status, failures,
    samples: observations.length, reasons: observations.filter((item) => !item.passed)
      .map((item) => item.failureFamily ?? 'recall_miss'),
    resources: {
      wallMs: observations.reduce((sum, item) => sum + Number(item.wallMs), 0),
      requestBytes: observations.some((item) => item.requestBytes === null) ? null
        : observations.reduce((sum, item) => sum + Number(item.requestBytes), 0),
      tokens: observations.some((item) => item.tokens === null) ? null
        : observations.reduce((sum, item) => sum + Number(item.tokens), 0),
    } };
}

export function decideRecallTechnologyGates(audits = []) {
  if (!Array.isArray(audits) || audits.some((item) => !STATUSES.has(item?.status))) {
    throw new TypeError('recall audits are invalid');
  }
  const failed = audits.filter((item) => item.status === 'failed');
  const insufficient = audits.filter((item) => item.status === 'insufficient_sample');
  const exactFailed = failed.some((item) => [
    'exact_identifier', 'source_provenance', 'historical_date', 'exact_project_person_scope',
  ].includes(item.lane));
  const expressionFailed = failed.some((item) => item.lane === 'expression_variance');
  const temporalFailed = failed.some((item) => ['historical_date', 'current_correction'].includes(item.lane));
  return {
    fts: exactFailed ? 'open_candidate' : insufficient.length ? 'insufficient_sample' : 'closed_no_deficit',
    embedding: expressionFailed && !exactFailed ? 'open_candidate' : 'closed_prerequisite_not_proven',
    temporalRelation: temporalFailed ? 'open_candidate' : 'closed_no_deficit',
    graph: 'closed_prerequisite_not_proven',
    deepRecallModel: 'closed_prerequisite_not_proven',
    failedCases: failed.map((item) => item.caseId),
    insufficientCases: insufficient.map((item) => item.caseId),
  };
}
