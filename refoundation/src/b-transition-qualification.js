export const B_QUALIFICATION_STATES = Object.freeze([
  'revise_current', 'extend_current', 'defer_after_delivery', 'independent', 'cancel',
]);

const expectedControlFor = (state) => ({
  revise_current: null,
  extend_current: null,
  defer_after_delivery: 'defer_after_delivery',
  independent: 'start_independent_work',
  cancel: 'cancel_current_work',
})[state];
const expectedShapeFor = (state) => ({
  revise_current: [1, 1], extend_current: [1, 1], defer_after_delivery: [1, 2],
  independent: [2, 2], cancel: [1, 1],
})[state];

export function validateBHoldout(value) {
  if (!value || !Array.isArray(value.cases) || !value.cases.length) throw new Error('B holdout cases are required');
  const ids = new Set();
  for (const item of value.cases) {
    if (!item?.id || ids.has(item.id) || !B_QUALIFICATION_STATES.includes(item.state)
      || !item.initialRequest || !item.admittedText
      || item.expectedControl !== expectedControlFor(item.state)
      || !Number.isInteger(item.expectedWorks) || !Number.isInteger(item.expectedRuns)
      || !Array.isArray(item.firstSurfaceMustInclude ?? [])
      || !Array.isArray(item.finalSurfaceMustInclude)
      || !Array.isArray(item.mustNotInclude ?? [])) throw new Error('invalid B blind holdout case');
    const [expectedWorks, expectedRuns] = expectedShapeFor(item.state);
    if (item.expectedWorks !== expectedWorks || item.expectedRuns !== expectedRuns
      || !item.finalSurfaceMustInclude.length
      || [...(item.firstSurfaceMustInclude ?? []), ...item.finalSurfaceMustInclude].some((marker) => (
        !/^[A-Z][A-Z0-9_-]{3,39}$/u.test(marker)
      ))) throw new Error('invalid B blind holdout outcome shape');
    if (item.state === 'defer_after_delivery' && !(item.firstSurfaceMustInclude ?? []).length) {
      throw new Error('deferred B case requires first-surface evidence');
    }
    if ((item.firstSurfaceMustInclude ?? []).some((marker) => !item.initialRequest.includes(marker))
      || item.finalSurfaceMustInclude.some((marker) => !item.admittedText.includes(marker))
      || (item.firstSurfaceMustInclude ?? []).some((marker) => item.finalSurfaceMustInclude.includes(marker))) {
      throw new Error('B holdout marker is not grounded in its user message');
    }
    ids.add(item.id);
  }
  return value;
}

export function selectBQualificationCases(cases, { onePerState = false } = {}) {
  if (!onePerState) return [...cases];
  return cases.filter((item, index) => cases.findIndex((candidate) => candidate.state === item.state) === index);
}

function includesAll(text, markers) { return markers.every((marker) => text.includes(marker)); }
function excludesAll(text, markers) { return markers.every((marker) => !text.includes(marker)); }
function runEvents(run) { return Array.isArray(run?.events) ? run.events : []; }

export function assessBQualificationCase(definition, observed) {
  const surfaces = observed.surfaces ?? []; const combined = surfaces.join('\n');
  const firstSurface = surfaces[0] ?? ''; const finalSurface = surfaces.at(-1) ?? '';
  const input = observed.input ?? null; const workState = observed.workState ?? { works: [], events: [], results: [] };
  const runs = observed.runs ?? []; const expectedControl = expectedControlFor(definition.state);
  const base = {
    admitted: observed.admittedStatus === 202,
    control: observed.actualControl === expectedControl,
    inputTerminal: input?.state === 'executed',
    workCount: workState.works.length === definition.expectedWorks,
    runCount: runs.length === definition.expectedRuns,
    firstSurface: includesAll(firstSurface, definition.firstSurfaceMustInclude ?? []),
    finalSurface: includesAll(finalSurface, definition.finalSurfaceMustInclude),
    surfaceExclusions: excludesAll(combined, definition.mustNotInclude ?? []),
  };
  const stateChecks = {};
  if (definition.state === 'revise_current' || definition.state === 'extend_current') {
    stateChecks.sameWork = workState.works.length === 1 && input?.disposition === 'current_work';
    stateChecks.sameRun = runs.length === 1 && input?.executionRunId === runs[0]?.runId;
  } else if (definition.state === 'defer_after_delivery') {
    stateChecks.deferredDisposition = input?.disposition === 'deferred_after_delivery';
    const deliveryIndex = workState.events.findIndex((event) => event.type === 'result_delivery_terminal'
      && event.runId === input?.deferredByRunId
      && (event.delivery?.sent === true
        || ['persisted', 'sent', 'delivered', 'succeeded'].includes(event.delivery?.state)));
    const activationIndex = workState.events.findIndex((event) => event.type === 'input_schedule_activated'
      && event.inputId === input?.inputId);
    stateChecks.deliveryBeforeActivation = deliveryIndex >= 0 && activationIndex > deliveryIndex;
    stateChecks.twoSeparateSurfaces = surfaces.length >= 2;
    stateChecks.deferredResultNotInFirstSurface = !includesAll(firstSurface, definition.finalSurfaceMustInclude);
  } else if (definition.state === 'independent') {
    stateChecks.independentWork = input?.disposition === 'independent_work' && workState.works.length === 2;
    stateChecks.previousWorkStopped = workState.works.some((work) => ['paused', 'cancelled'].includes(work.status));
    const firstRunId = input?.presentedRunId ?? runs[0]?.runId;
    stateChecks.transitionRunDidNotCompleteOldWork = !workState.events.some((event) => (
      event.type === 'completion_proposed' && event.runId === firstRunId
    ));
    stateChecks.newPurposeNotInTransitionSurface = !includesAll(firstSurface, definition.finalSurfaceMustInclude);
  } else if (definition.state === 'cancel') {
    stateChecks.cancelled = workState.works.length === 1 && workState.works[0]?.status === 'cancelled';
    stateChecks.noCompletionProposal = !workState.events.some((event) => event.type === 'completion_proposed');
    const events = runEvents(runs[0]);
    const controlIndex = events.findIndex((event) => event.type === 'tool_completed'
      && event.payload?.receipt?.requestedCall?.name === 'work_control');
    stateChecks.noPostCancelToolStart = controlIndex >= 0 && !events.slice(controlIndex + 1).some((event) => (
      event.type === 'tool_started' && event.payload?.name !== 'work_control'
    ));
  }
  const checks = { ...base, ...stateChecks };
  const diagnostics = {
    finalMarkersInFirstSurface: includesAll(firstSurface, definition.finalSurfaceMustInclude),
    finalMarkersInAnySurface: includesAll(combined, definition.finalSurfaceMustInclude),
    surfaceCount: surfaces.length,
  };
  return { passed: Object.values(checks).every(Boolean), checks, diagnostics };
}
