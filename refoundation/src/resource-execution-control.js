/**
 * Builds platform-neutral execution waves from physical capacity. Hands that already fan
 * out internally run in an exclusive outer wave so model fan-out is not multiplied by Hand fan-out.
 */
export function resourceExecutionWaves(items, capacity) {
  if (!Number.isInteger(capacity) || capacity < 1) throw new TypeError('parallel capacity must be positive');
  const waves = []; let current = [];
  const flush = () => { if (current.length) waves.push(current); current = []; };
  for (const item of items) {
    if (item.tool?.nestedParallelism === true) { flush(); waves.push([item]); continue; }
    current.push(item); if (current.length >= capacity) flush();
  }
  flush(); return waves;
}
