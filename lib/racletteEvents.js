const crypto = require('node:crypto');
const { getJson, setJson, listKeys, mgetJson } = require('./vercelStore');

const templates = {
  swordtrial: { title: 'Sword Trial', capacity: 5, mode: 'raid', botAccessible: true },
  heroesrealm: { title: 'Heroes Realm', capacity: 10, mode: 'raid', botAccessible: true },
  tower: { title: 'Tower', capacity: 10, mode: 'raid', botAccessible: true },
  gvg: { title: 'GvG', capacity: 50, mode: 'raid', botAccessible: true },
  gvg_l: { title: 'GvG - LEAGUE', capacity: 50, mode: 'raid', botAccessible: true },
  gvg_r: { title: 'GvG - Ranked', capacity: 50, mode: 'raid', botAccessible: true },
  gvg_c: { title: 'GvG - Challenge', capacity: 50, mode: 'raid', botAccessible: true },
  arena_3: { title: 'Arena - 3v3', capacity: 3, mode: 'raid', botAccessible: true },
  arena_5: { title: 'Arena - 5v5', capacity: 5, mode: 'raid', botAccessible: true },
  forest_5: { title: 'Forest Squad', capacity: 5, mode: 'raid', botAccessible: true },
  guild_event: { title: 'Guild Event', capacity: null, mode: 'social', botAccessible: true },
  web_custom: { title: 'Web Custom', capacity: null, mode: 'announce', botAccessible: false }
};

const recurrenceMs = { none: 0, custom: 0 };
const weekdayMap = { lun: 1, mar: 2, mer: 3, jeu: 4, ven: 5, sam: 6, dim: 0 };

function newEvent({ guildId, channelId, template, startsAt, recurrence = 'none', recurrenceDays = [], recurrenceEndsAt = null, title, subtitle, mediaUrl = '', mode, timezone = 'Europe/Paris', pingRoleIds = [] }) {
  const base = templates[template] || { title: 'Event', capacity: null, mode: 'raid' };
  return {
    id: crypto.randomUUID().slice(0, 10),
    guildId,
    channelId,
    template,
    mode: mode || base.mode,
    title: title || base.title,
    subtitle: subtitle || '',
    mediaUrl: mediaUrl || '',
    capacity: base.capacity,
    startsAt,
    timezone,
    recurrence,
    recurrenceDays,
    recurrenceEndsAt,
    pingRoleIds,
    archived: false,
    reminded: false,
    startedPinged: false,
    reminderMessageIds: [],
    messageId: null,
    attendees: {},
    createdAt: Date.now()
  };
}

const key = (eventId) => `event:${eventId}`;
const draftKey = (draftId) => `draft:${draftId}`;


const EVENTS_CACHE_TTL_MS = 10 * 1000;
let eventsCache = { ts: 0, items: null };

function invalidateEventsCache() {
  eventsCache = { ts: 0, items: null };
}

async function saveEvent(event) {
  await setJson(key(event.id), event);
  invalidateEventsCache();
}

async function getEvent(eventId) {
  const cached = eventsCache.items?.find((e) => e?.id === eventId);
  if (cached) return cached;
  return getJson(key(eventId));
}

async function getAllEvents() {
  if (eventsCache.items && (Date.now() - eventsCache.ts) < EVENTS_CACHE_TTL_MS) return eventsCache.items;
  const keys = await listKeys('event:');
  const BATCH_SIZE = 200;
  const chunks = [];
  for (let i = 0; i < keys.length; i += BATCH_SIZE) chunks.push(keys.slice(i, i + BATCH_SIZE));
  const batches = await Promise.all(chunks.map((chunk) => mgetJson(chunk)));
  const items = batches.flat().filter(Boolean);
  eventsCache = { ts: Date.now(), items };
  return items;
}

async function saveDraft(draft) {
  const id = draft.id || crypto.randomUUID().slice(0, 10);
  const full = { ...draft, id };
  await setJson(draftKey(id), full);
  return full;
}
async function getDraft(id) { return getJson(draftKey(id)); }
async function deleteDraft(id) { await setJson(draftKey(id), null); }

function nextTimestampFromSelectedDays(startsAt, recurrenceDays = []) {
  const set = new Set(recurrenceDays.map((d) => weekdayMap[d]).filter((d) => d === 0 || Number.isInteger(d)));
  if (!set.size) return null;
  const base = new Date(startsAt);
  for (let offset = 1; offset <= 14; offset += 1) {
    const candidate = new Date(base.getTime());
    candidate.setDate(candidate.getDate() + offset);
    if (set.has(candidate.getDay())) return candidate.getTime();
  }
  return null;
}

function tzParts(ts, timezone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(new Date(ts));
  const map = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: map.weekday.toLowerCase()
  };
}

function getTimeZoneOffsetMs(timestamp, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(new Date(timestamp));
  const map = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), Number(map.hour), Number(map.minute), Number(map.second));
  return asUtc - timestamp;
}

function parseDateTimeInTimeZone({ year, month, day, hour, minute, second = 0 }, timezone) {
  const approxUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let offset = getTimeZoneOffsetMs(approxUtc, timezone);
  let result = approxUtc - offset;
  const correctedOffset = getTimeZoneOffsetMs(result, timezone);
  if (correctedOffset !== offset) result = approxUtc - correctedOffset;
  return result;
}


function addDaysInTimezoneKeepingWallClock(startsAt, daysToAdd, timezone = 'Europe/Paris') {
  const base = tzParts(startsAt, timezone);
  const anchor = new Date(Date.UTC(base.year, base.month - 1, base.day + daysToAdd, 12, 0, 0));
  const targetDay = tzParts(anchor.getTime(), timezone);
  return parseDateTimeInTimeZone({
    year: targetDay.year,
    month: targetDay.month,
    day: targetDay.day,
    hour: base.hour,
    minute: base.minute,
    second: base.second
  }, timezone);
}

function nextCustomRecurrenceTimestamp(event) {
  const set = new Set((event.recurrenceDays || []).map((d) => weekdayMap[d]).filter((d) => d === 0 || Number.isInteger(d)));
  if (!set.size) return null;
  const timezone = event.timezone || 'Europe/Paris';
  const base = tzParts(event.startsAt, timezone);
  const jsDay = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }[base.weekday] ?? new Date(event.startsAt).getDay();
  for (let offset = 1; offset <= 21; offset += 1) {
    const candidate = new Date(Date.UTC(base.year, base.month - 1, base.day + offset, 12, 0, 0));
    const local = tzParts(candidate.getTime(), timezone);
    const localDay = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }[local.weekday] ?? ((jsDay + offset) % 7);
    if (set.has(localDay)) {
      return parseDateTimeInTimeZone({
        year: local.year,
        month: local.month,
        day: local.day,
        hour: base.hour,
        minute: base.minute,
        second: base.second
      }, timezone);
    }
  }
  return null;
}

function nextRecurrenceTimestamp(event) {
  if (event.recurrence === 'custom') return nextCustomRecurrenceTimestamp(event);
  if (event.recurrence === 'daily') return addDaysInTimezoneKeepingWallClock(event.startsAt, 1, event.timezone || 'Europe/Paris');
  if (event.recurrence === 'weekly') return addDaysInTimezoneKeepingWallClock(event.startsAt, 7, event.timezone || 'Europe/Paris');
  return null;
}

module.exports = {
  templates,
  recurrenceMs,
  weekdayMap,
  newEvent,
  saveEvent,
  getEvent,
  getAllEvents,
  saveDraft,
  getDraft,
  deleteDraft,
  nextRecurrenceTimestamp
};
