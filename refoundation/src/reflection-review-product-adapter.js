import {
  makeReflectionReviewCurrentEvidenceObserver,
  ReflectionReviewCoordinator,
} from './reflection-review-coordinator.js';

export function makeReflectionReviewProductAdapter({ ledger, recordSourceReader,
  sourceWindowCoordinator, observeCurrentEvidence } = {}) {
  if (!ledger || !recordSourceReader || !sourceWindowCoordinator
    || typeof observeCurrentEvidence !== 'function') {
    throw new TypeError('Reflection review product adapter dependencies are required');
  }
  const currentEvidenceObserver = makeReflectionReviewCurrentEvidenceObserver({
    sourceWindowCoordinator, observe: observeCurrentEvidence,
  });
  return new ReflectionReviewCoordinator({ ledger, recordSourceReader, currentEvidenceObserver });
}
