const { getAllEvents, saveEvent, newEvent, nextRecurrenceTimestamp } = require('../../lib/racletteEvents'); // TO CHANGE
const { sendChannelMessage, editChannelMessage, deleteChannelMessage } = require('../../lib/discordApi');
const { getJson, setJson, mgetJson } = require('../../lib/vercelStore');

const ARCHIVE_LOG_CHANNEL_ID = process.env.ARCHIVE_LOG_CHANNEL_ID || '1512519488208375828'; // ID TO CHANGE HERE
const EVENT_PING_ROLE_ID = process.env.EVENT_PING_ROLE_ID || '1512495672572641361';
const LEGACY_ROLE_IDS = new Set([]);
const { eventButtons, eventEmbed } = require('../../lib/components');
const TEMP_VOCAL_TRIGGER_CHANNEL_ID = process.env.TEMP_VOCAL_TRIGGER_CHANNEL_ID || '1512143389859250302';
const TEN_MIN_REMINDER_WINDOW_MS = 15 * 60 * 1000;
const START_PING_WINDOW_MS = 30 * 60 * 1000;
const EARLY_TRIGGER_LEEWAY_MS = 60 * 1000;

const MAX_EXACT_WAIT_MS = Number(process.env.CRON_MAX_EXACT_WAIT_MS || 0);

const RANDOM_SCHEDULES_KEY = 'randomphrase:schedules';
const RANDOM_RECENT_WINDOW_MAX = 50;
const CRON_MAX_HANDLER_MS = Number(process.env.CRON_MAX_HANDLER_MS || 9000);
const CRON_MAX_RANDOM_SENDS_PER_RUN = Number(process.env.CRON_MAX_RANDOM_SENDS_PER_RUN || 2);

const RANDOM_INTERVAL_MIN_MINUTES = Number(process.env.RANDOM_INTERVAL_MIN_MINUTES || 840);
const RANDOM_INTERVAL_MAX_MINUTES = Number(process.env.RANDOM_INTERVAL_MAX_MINUTES || 840);
const RANDOM_SILENT_HOUR_START_FR = Number(process.env.RANDOM_SILENT_HOUR_START_FR || 23);
const RANDOM_SILENT_HOUR_END_FR = Number(process.env.RANDOM_SILENT_HOUR_END_FR || 9);
const FRANCE_TIMEZONE = process.env.RANDOM_SCHEDULE_TIMEZONE || 'Europe/Paris';

function franceHour(ts) {
  try {
    const parts = new Intl.DateTimeFormat('fr-FR', { timeZone: FRANCE_TIMEZONE, hour: '2-digit', hour12: false }).formatToParts(new Date(ts));
    const hourPart = parts.find((p) => p.type === 'hour')?.value;
    const hour = Number(hourPart);
    return Number.isFinite(hour) ? hour : new Date(ts).getUTCHours();
  } catch {
    return new Date(ts).getUTCHours();
  }
}

function isFranceQuietHour(ts) {
  const hour = franceHour(ts);
  if (!Number.isFinite(hour)) return false;
  if (RANDOM_SILENT_HOUR_START_FR === RANDOM_SILENT_HOUR_END_FR) return false;
  if (RANDOM_SILENT_HOUR_START_FR < RANDOM_SILENT_HOUR_END_FR) {
    return hour >= RANDOM_SILENT_HOUR_START_FR && hour < RANDOM_SILENT_HOUR_END_FR;
  }
  return hour >= RANDOM_SILENT_HOUR_START_FR || hour < RANDOM_SILENT_HOUR_END_FR;
}

function nextFranceAllowedTs(fromTs) {
  if (!isFranceQuietHour(fromTs)) return fromTs;
  const stepMs = 5 * 60 * 1000;
  let ts = fromTs;
  for (let i = 0; i < (24 * 60) / 5; i += 1) {
    ts += stepMs;
    if (!isFranceQuietHour(ts)) return ts;
  }
  return fromTs + (10 * 60 * 60 * 1000);
}

function pickRandomIntervalMs(schedule = {}) {
  const fixedMinutes = Math.max(1, Number(schedule.intervalMinutes || schedule.minIntervalMinutes || schedule.maxIntervalMinutes || RANDOM_INTERVAL_MIN_MINUTES));
  return fixedMinutes * 60 * 1000;
}


function normalizePhraseHistory(items = [], max) {
  return (items || []).map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 0).slice(0, max);
}

async function getRandomPhraseForGuild(guildId = 'global') {
  const historyKey = `randomphrase:recent:${guildId || 'global'}`;
  const [phrasesRaw, recentRaw] = await mgetJson(['config:phrases', historyKey]);
  if (!Array.isArray(phrasesRaw) || !phrasesRaw.length) return null;

  const clean = phrasesRaw.map((p) => String(p || '').trim()).filter(Boolean);
  if (!clean.length) return null;

  const recent = normalizePhraseHistory(recentRaw, RANDOM_RECENT_WINDOW_MAX).filter((n) => n < clean.length);
  const windowSize = Math.max(3, Math.min(RANDOM_RECENT_WINDOW_MAX, Math.max(1, clean.length - 1)));
  const recentSet = new Set(recent.slice(0, windowSize));

  const eligible = clean.map((_, idx) => idx).filter((idx) => !recentSet.has(idx));
  const pickPool = eligible.length ? eligible : clean.map((_, idx) => idx);
  const pickedIndex = pickPool[Math.floor(Math.random() * pickPool.length)];

  const nextHistory = [pickedIndex, ...recent.filter((idx) => idx !== pickedIndex)].slice(0, windowSize);
  await setJson(historyKey, nextHistory);

  return clean[pickedIndex];
}

async function processRandomSchedules(now, deadlineTs = Date.now() + CRON_MAX_HANDLER_MS) {
  const schedules = await getJson(RANDOM_SCHEDULES_KEY, []);
  if (!Array.isArray(schedules) || !schedules.length) return { sent: 0, errors: 0 };

  let sent = 0;
  let errors = 0;
  let timedOut = false;
  let changed = false;

  for (const schedule of schedules) {
    if (Date.now() >= deadlineTs || sent >= CRON_MAX_RANDOM_SENDS_PER_RUN) { timedOut = true; break; }
    if (!schedule?.active) continue;
    const dueAt = Number(schedule.nextRunAt || 0);
    if (!Number.isFinite(dueAt) || now < dueAt) continue;

    const allowedAt = nextFranceAllowedTs(now);
    if (allowedAt > now) {
      schedule.nextRunAt = allowedAt;
      changed = true;
      continue;
    }

    try {
      const phrase = await getRandomPhraseForGuild(schedule.guildId || 'global');
      if (phrase) {
        await sendChannelMessage(schedule.channelId, { content: String(phrase) });
        sent += 1;
      }
      schedule.nextRunAt = nextFranceAllowedTs(now + pickRandomIntervalMs(schedule));
      schedule.lastSentAt = now;
      changed = true;
    } catch {
      errors += 1;
      schedule.nextRunAt = nextFranceAllowedTs(now + pickRandomIntervalMs(schedule));
      changed = true;
    }
  }

  if (changed) await setJson(RANDOM_SCHEDULES_KEY, schedules);
  return { sent, errors, timedOut };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForExactSecond(targetTs) {
  if (process.env.CRON_EXACT_TIMING !== 'true') return;
  const delta = targetTs - Date.now();
  if (delta > 0 && delta <= MAX_EXACT_WAIT_MS) await sleep(delta);
}

function isAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.authorization;
  const querySecret = req.query?.secret;
  if (auth === `Bearer ${secret}`) return true;
  if (querySecret === secret) return true;
  if (req.headers['x-vercel-cron'] && process.env.ALLOW_VERCEL_CRON === 'true') return true;
  return false;
}

function normalizeGuildEventPingRoles(event) {
  if (event.template !== 'guild_event' || event.pingMode !== 'roles') return false;
  const before = Array.isArray(event.pingRoleIds) ? event.pingRoleIds.map(String) : [];
  const cleaned = before.filter((id) => id && !LEGACY_ROLE_IDS.has(id));
  const next = cleaned.length ? [...new Set(cleaned)] : [EVENT_PING_ROLE_ID];
  const changed = next.join('|') !== before.join('|');
  if (changed) event.pingRoleIds = next;
  return changed;
}

function roleMentionsForAutoPing(event) {
  if (Array.isArray(event.pingRoleIds) && event.pingRoleIds.length) return event.pingRoleIds.map((id) => `<@&${id}>`).join(' | ');
  return `<@&${EVENT_PING_ROLE_ID}>`;
}

function attendeeMentions(event) {
  const eligibleRoles = event.mode === 'social' || event.mode === 'announce'
    ? ['present', 'maybe']
    : ['tank', 'dps', 'healer', 'bench'];

  const mentionId = (id, attendee = {}) => {
    if (/^\d+$/.test(String(id || ''))) return String(id);
    if (/^\d+$/.test(String(attendee.userId || ''))) return String(attendee.userId);
    return '';
  };

  const attendees = event?.attendees && typeof event.attendees === 'object' ? event.attendees : {};

  const mentions = Object.entries(attendees)
    .filter(([, a]) => eligibleRoles.includes(a.role))
    .map(([id, attendee]) => mentionId(id, attendee))
    .filter(Boolean)
    .map((id) => `<@${id}>`);

  if (/^\d+$/.test(String(event.organizerId || ''))) mentions.push(`<@${event.organizerId}>`);
  return [...new Set(mentions)].join(' ');
}

async function sendReminder(channelId, title, prefix, mentions, voiceHint = '') {
  const mentionLine = mentions ? `
Calling: ${mentions}` : '';
  const content = `${prefix}: ${title}${mentionLine}${voiceHint}`.trim();
  try {
    return await sendChannelMessage(channelId, { content });
  } catch {
    const fallback = `${prefix}: ${title}${voiceHint}`.trim();
    return sendChannelMessage(channelId, { content: fallback });
  }
}

module.exports = async function handler(req, res) {
  if (!isAuthorized(req)) {
    return res.status(401).json({
      ok: false,
      error: 'Unauthorized',
      hint: 'Call with Authorization: Bearer <CRON_SECRET> OR ?secret=<CRON_SECRET>. For Vercel native cron set ALLOW_VERCEL_CRON=true.'
    });
  }

  const now = Date.now();
  const deadlineTs = now + CRON_MAX_HANDLER_MS;
  const events = await getAllEvents();
  let reminders10 = 0;
  let reminders0 = 0;
  let archived = 0;
  let recurrences = 0;
  let errors = 0;
  let randomAutoSent = 0;
  let randomAutoErrors = 0;
  let timedOut = false;

  try {
    const randomStats = await processRandomSchedules(now, deadlineTs);
    randomAutoSent = randomStats.sent;
    randomAutoErrors = randomStats.errors;
    timedOut = timedOut || !!randomStats.timedOut;
  } catch {
    randomAutoErrors += 1;
  }

  for (const event of events) {
    if (Date.now() >= deadlineTs) { timedOut = true; break; }
    try {
      if (event.archived) continue;

    if (normalizeGuildEventPingRoles(event)) await saveEvent(event);

    const reminderAt = event.startsAt - 10 * 60 * 1000;
    const isInsideTenMinuteWindow = now >= reminderAt - EARLY_TRIGGER_LEEWAY_MS && now < event.startsAt + TEN_MIN_REMINDER_WINDOW_MS;
    const isInsideStartWindow = now >= event.startsAt - EARLY_TRIGGER_LEEWAY_MS && now < event.startsAt + START_PING_WINDOW_MS;

    if (!event.reminded && isInsideTenMinuteWindow) {
      try {
        await waitForExactSecond(reminderAt);
        const mentions = event.pingMode === 'roles' ? roleMentionsForAutoPing(event) : attendeeMentions(event);
        const prefix = event.mode === 'announce' ? '🔁 WEEKLY EVENT' : '⏰ REMINDER';
        const ping10 = await sendReminder(event.channelId, `${event.title} starts in 10 minutes!`, prefix, mentions);
        event.reminderMessageIds = [...new Set([...(event.reminderMessageIds || []), ping10.id])];
        event.reminded = true;
        await saveEvent(event);
        reminders10 += 1;
      } catch {
        errors += 1;
      }
    }

    if (!event.startedPinged && isInsideStartWindow) {
      try {
        await waitForExactSecond(event.startsAt);
        const mentions = event.pingMode === 'roles' ? roleMentionsForAutoPing(event) : attendeeMentions(event);
        const prefix = event.mode === 'announce' ? '🔁 WEEKLY EVENT' : '⏰ REMINDER';
        const voiceHint = ['donjon', 'raid'].includes(event.template) ? `
🎙️ Vocal auto: rejoignez <#${TEMP_VOCAL_TRIGGER_CHANNEL_ID}> pour créer le vocal temporaire.` : '';
        const startOffsetMs = Date.now() - event.startsAt;
        const startLabel = startOffsetMs < 0
          ? `${event.title} starts in less than a minute!`
          : startOffsetMs > 2 * 60 * 1000
            ? `${event.title} started a few minutes ago!`
            : `${event.title} starts now!`;
        const ping0 = await sendReminder(event.channelId, startLabel, prefix, mentions, voiceHint);
        event.reminderMessageIds = [...new Set([...(event.reminderMessageIds || []), ping0.id])];
        event.startedPinged = true;
        await saveEvent(event);
        reminders0 += 1;
      } catch {
        errors += 1;
      }
    }

    if (now >= event.startsAt + 4 * 60 * 60 * 1000) {
      for (const pingId of event.reminderMessageIds || []) {
        try { await deleteChannelMessage(event.channelId, pingId); } catch {}
      }
      event.reminderMessageIds = [];

      const nextTs = nextRecurrenceTimestamp(event);
      if (nextTs && (!event.recurrenceEndsAt || nextTs <= event.recurrenceEndsAt) && !event.nextGeneratedAt) {
        const next = newEvent({
          guildId: event.guildId,
          channelId: event.channelId,
          template: event.template,
          startsAt: nextTs,
          recurrence: event.recurrence,
          recurrenceDays: event.recurrenceDays,
          recurrenceEndsAt: event.recurrenceEndsAt || null,
          mode: event.mode,
          title: event.title,
          subtitle: event.subtitle,
          mediaUrl: event.mediaUrl || '',
          timezone: event.timezone,
          pingRoleIds: event.pingRoleIds || []
        });
        next.organizerId = event.organizerId;
        next.pingMode = event.pingMode;

        const msg = await sendChannelMessage(event.channelId, {
          embeds: [eventEmbed(next)],
          components: eventButtons(next.id, false, next.mode)
        });
        next.messageId = msg.id;
        await saveEvent(next);
        recurrences += 1;
        event.nextGeneratedAt = Date.now();
      }

      const isRecurring = ['weekly', 'custom', 'daily'].includes(event.recurrence);
      if (!event.messageDeletedAt) {
        try { await deleteChannelMessage(event.channelId, event.messageId); } catch {}
        event.messageDeletedAt = Date.now();
      }

      if (!isRecurring) {
        event.archived = true;
      } else {
        event.archived = true;
        event.recurringHistory = true;
      }
      await saveEvent(event);
      archived += 1;
      await sendChannelMessage(ARCHIVE_LOG_CHANNEL_ID, {
        content: `🗃️ Event ${isRecurring ? 'instance cloturée' : 'archivé'}: **${event.title}** (ID: \`${event.id}\`) — prévu pour <t:${Math.floor(event.startsAt / 1000)}:F> dans <#${event.channelId}>.`
      });
    }
    } catch {
      errors += 1;
    }
  }

  return res.status(200).json({ ok: true, reminders10, reminders0, archived, recurrences, randomAutoSent, randomAutoErrors, errors, timedOut, durationMs: Date.now() - now });
};
