import { validateTriggerSpec } from './automation-contracts.js';

export const MAX_CATCH_UP_OCCURRENCES = 1;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const formatterCache = new Map();

function finite(value) {
  return Number.isFinite(value);
}

function assertTrigger(trigger) {
  const checked = validateTriggerSpec(trigger);
  if (!checked.ok) throw new TypeError(`trigger invalid: ${checked.errors.join('; ')}`);
  return trigger;
}

function formatterFor(timezone) {
  let formatter = formatterCache.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatterCache.set(timezone, formatter);
  }
  return formatter;
}

function localParts(timestamp, timezone) {
  const values = Object.fromEntries(
    formatterFor(timezone).formatToParts(timestamp)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function localDate(timestamp, timezone) {
  const { year, month, day } = localParts(timestamp, timezone);
  return { year, month, day };
}

function addLocalDays(date, days) {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function localDayNumber(date) {
  return Math.floor(Date.UTC(date.year, date.month - 1, date.day) / DAY_MS);
}

function localWeekday(date) {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

function localTime(trigger) {
  const [hour, minute] = trigger.localTime.split(':').map(Number);
  return { hour, minute };
}

function sameLocalMinute(parts, target) {
  return parts.year === target.year
    && parts.month === target.month
    && parts.day === target.day
    && parts.hour === target.hour
    && parts.minute === target.minute;
}

function possibleOffsets(localTimestamp, timezone) {
  const offsets = new Set();
  for (const distance of [-36 * 60 * MINUTE_MS, 0, 36 * 60 * MINUTE_MS]) {
    const instant = localTimestamp + distance;
    const parts = localParts(instant, timezone);
    const renderedAsUtc = Date.UTC(
      parts.year, parts.month - 1, parts.day,
      parts.hour, parts.minute, parts.second,
    );
    offsets.add(renderedAsUtc - instant);
  }
  return [...offsets];
}

function instantsForLocalMinute(target, timezone, offsets) {
  const localTimestamp = Date.UTC(
    target.year, target.month - 1, target.day,
    target.hour, target.minute, 0, 0,
  );
  const instants = [];
  for (const offset of offsets) {
    const instant = localTimestamp - offset;
    if (sameLocalMinute(localParts(instant, timezone), target)) instants.push(instant);
  }
  return [...new Set(instants)].sort((left, right) => left - right);
}

function occurrenceOnLocalDate(trigger, date) {
  const requested = localTime(trigger);
  const requestedLocal = Date.UTC(
    date.year, date.month - 1, date.day,
    requested.hour, requested.minute, 0, 0,
  );
  const offsets = possibleOffsets(requestedLocal, trigger.timezone);
  const minutesLeft = (24 * 60) - ((requested.hour * 60) + requested.minute);

  // A gap has no exact instant. Preserve the requested local date and choose
  // its first valid wall-clock minute after the gap. An overlap deliberately
  // chooses its earliest instant so one wall-clock occurrence cannot run twice.
  for (let minuteOffset = 0; minuteOffset < minutesLeft; minuteOffset += 1) {
    const shifted = new Date(requestedLocal + (minuteOffset * MINUTE_MS));
    const target = {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: shifted.getUTCHours(),
      minute: shifted.getUTCMinutes(),
    };
    const instants = instantsForLocalMinute(target, trigger.timezone, offsets);
    if (instants.length > 0) return instants[0];
  }
  return null;
}

function calendarDayMatches(trigger, date) {
  return trigger.kind === 'daily'
    || (trigger.kind === 'weekly' && trigger.weekdays.includes(localWeekday(date)));
}

function nextCalendarOccurrence(trigger, after) {
  const firstDate = localDate(after, trigger.timezone);
  for (let dayOffset = 0; dayOffset <= 14; dayOffset += 1) {
    const date = addLocalDays(firstDate, dayOffset);
    if (!calendarDayMatches(trigger, date)) continue;
    const occurrence = occurrenceOnLocalDate(trigger, date);
    if (occurrence !== null && occurrence > after) return occurrence;
  }
  return null;
}

function latestCalendarOccurrence(trigger, now) {
  const firstDate = localDate(now, trigger.timezone);
  for (let dayOffset = 0; dayOffset <= 14; dayOffset += 1) {
    const date = addLocalDays(firstDate, -dayOffset);
    if (!calendarDayMatches(trigger, date)) continue;
    const occurrence = occurrenceOnLocalDate(trigger, date);
    if (occurrence !== null && occurrence <= now) return occurrence;
  }
  return null;
}

/** Return the first occurrence strictly after `after`. */
export function nextTriggerOccurrence(trigger, after) {
  assertTrigger(trigger);
  if (!finite(after)) throw new TypeError('after must be finite');

  if (trigger.kind === 'once') return trigger.at > after ? trigger.at : null;
  if (trigger.kind === 'interval') {
    if (!finite(trigger.nextRunAt)) return null;
    if (trigger.nextRunAt > after) return trigger.nextRunAt;
    const steps = Math.floor((after - trigger.nextRunAt) / trigger.intervalMs) + 1;
    return trigger.nextRunAt + (steps * trigger.intervalMs);
  }
  return nextCalendarOccurrence(trigger, after);
}

function latestDue(trigger, cursor, now) {
  if (cursor > now) return null;
  if (trigger.kind === 'once') return cursor;
  if (trigger.kind === 'interval') {
    const steps = Math.floor((now - cursor) / trigger.intervalMs);
    return cursor + (steps * trigger.intervalMs);
  }
  const occurrence = latestCalendarOccurrence(trigger, now);
  return occurrence !== null && occurrence >= cursor ? occurrence : null;
}

function weeklyOccurrenceCount(trigger, start, end) {
  const startDay = localDayNumber(localDate(start, trigger.timezone));
  const endDay = localDayNumber(localDate(end, trigger.timezone));
  const days = endDay - startDay + 1;
  const fullWeeks = Math.floor(days / 7);
  let count = fullWeeks * new Set(trigger.weekdays).size;
  for (let offset = fullWeeks * 7; offset < days; offset += 1) {
    const date = addLocalDays(localDate(start, trigger.timezone), offset);
    if (trigger.weekdays.includes(localWeekday(date))) count += 1;
  }
  return count;
}

function dueCount(trigger, cursor, latest) {
  if (trigger.kind === 'once') return 1;
  if (trigger.kind === 'interval') {
    return Math.floor((latest - cursor) / trigger.intervalMs) + 1;
  }
  if (trigger.kind === 'daily') {
    const start = localDayNumber(localDate(cursor, trigger.timezone));
    const end = localDayNumber(localDate(latest, trigger.timezone));
    return end - start + 1;
  }
  return weeklyOccurrenceCount(trigger, cursor, latest);
}

function occurrenceAfter(trigger, occurrence) {
  if (trigger.kind === 'once') return null;
  if (trigger.kind === 'interval') return occurrence + trigger.intervalMs;
  return nextCalendarOccurrence(trigger, occurrence);
}

/**
 * Derive work from a durable schedule cursor. The cursor is advanced past every
 * observed due time, while work output is always bounded to one occurrence.
 */
export function planTriggerOccurrences(trigger, {
  nextRunAt,
  now,
  recovering = false,
} = {}) {
  assertTrigger(trigger);
  if (!finite(now)) throw new TypeError('now must be finite');
  if (nextRunAt !== null && !finite(nextRunAt)) throw new TypeError('nextRunAt must be finite or null');
  if (nextRunAt === null) {
    return {
      occurrences: [], nextRunAt: null, skippedCount: 0,
      dueCount: 0, recovering, reason: 'exhausted',
    };
  }

  const latest = latestDue(trigger, nextRunAt, now);
  if (latest === null) {
    return {
      occurrences: [], nextRunAt, skippedCount: 0,
      dueCount: 0, recovering, reason: 'not_due',
    };
  }

  const count = dueCount(trigger, nextRunAt, latest);
  const misfired = count > 1 || (recovering && latest < now);
  const onTimeOccurrence = latest === now;
  const emitOccurrence = !misfired
    || trigger.misfirePolicy === 'catch_up_once'
    || onTimeOccurrence;
  const occurrences = emitOccurrence ? [latest] : [];
  const skippedCount = count - occurrences.length;
  return {
    occurrences,
    nextRunAt: occurrenceAfter(trigger, latest),
    skippedCount,
    dueCount: count,
    recovering,
    reason: misfired
      ? (trigger.misfirePolicy === 'catch_up_once'
        ? 'catch_up_once'
        : (onTimeOccurrence ? 'scheduled_after_misfire_skip' : 'misfire_skipped'))
      : 'scheduled',
  };
}
