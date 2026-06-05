const { getAllEvents, getEvent, saveEvent, newEvent } = require('../lib/racletteEvents'); // TO CHANGE
const { sendChannelMessage, sendChannelMessageWithAttachment, editChannelMessage, editChannelMessageWithAttachment, deleteChannelMessage, getGuildMemberDisplayName } = require('../lib/discordApi');
const { eventButtons, eventEmbed } = require('../lib/components');

const DEFAULT_TIMEZONE = process.env.EVENT_TIMEZONE || 'Europe/Paris';
const ARCHIVE_LOG_CHANNEL_ID = process.env.ARCHIVE_LOG_CHANNEL_ID || '1512519488208375828'; // ID TO CHANGE HERE
const GUILD_EVENT_CHANNEL_ID = process.env.GUILD_EVENT_CHANNEL_ID || '1512499011641413803';
const GVG_EVENT_CHANNEL_ID = process.env.GVG_EVENT_CHANNEL_ID || '1512520519973470290';
const EVENT_PING_ROLE_ID = process.env.EVENT_PING_ROLE_ID || '1512495672572641361';

function eventComponentsFor(event) {
  return eventButtons(event.id, !!event.archived, event.mode);
}

async function hydrateAttendeeDisplayNames(event) {
  if (!event?.guildId || !event?.attendees || typeof event.attendees !== 'object') return false;
  let changed = false;
  for (const [userId, attendee] of Object.entries(event.attendees)) {
    if (!attendee || attendee.displayName) continue;
    const name = await getGuildMemberDisplayName(event.guildId, userId);
    if (name) {
      event.attendees[userId] = { ...attendee, userId: attendee.userId || userId, displayName: name };
      changed = true;
    }
  }
  return changed;
}

const LEGACY_ROLE_IDS = new Set([]); // No Legacy Roles ID yet

function normalizeGuildEventPingRoles(event) {
  if (event.template !== 'guild_event' || event.pingMode !== 'roles') return;
  const raw = Array.isArray(event.pingRoleIds) ? event.pingRoleIds.map((x) => String(x).trim()) : [];
  const filtered = raw.filter((id) => id && !LEGACY_ROLE_IDS.has(id));
  event.pingRoleIds = filtered.length ? [...new Set(filtered)] : [EVENT_PING_ROLE_ID];
}

function isAuthorized(req) {
  const secret = process.env.DASHBOARD_SECRET || process.env.COMMANDS_SECRET || process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.authorization === `Bearer ${secret}` || req.query?.secret === secret;
}

function normalizeDate(dateStr, allowDefaultToday = false) {
  const value = String(dateStr || '').trim().toLowerCase();
  if (!value && allowDefaultToday) {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }
  if (value === 'today') {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }
  const m = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
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
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );
  return asUtc - timestamp;
}

function parseDateTimeInTimeZone(dateIso, timeStr, timeZone = DEFAULT_TIMEZONE) {
  const [year, month, day] = dateIso.split('-').map(Number);
  const [hour, minute] = String(timeStr).split(':').map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;

  const approxUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let offset = getTimeZoneOffsetMs(approxUtc, timeZone);
  let result = approxUtc - offset;

  const correctedOffset = getTimeZoneOffsetMs(result, timeZone);
  if (correctedOffset !== offset) result = approxUtc - correctedOffset;

  return result;
}

function parseDate(dateStr, timeStr, allowDefaultToday = false, timezone = DEFAULT_TIMEZONE) {
  if (!/^\d{2}:\d{2}$/.test(String(timeStr || '').trim())) return null;
  const date = normalizeDate(dateStr, allowDefaultToday);
  if (!date) return null;
  return parseDateTimeInTimeZone(date, timeStr, timezone || DEFAULT_TIMEZONE);
}


function parseDateOnly(dateStr) {
  if (!dateStr) return null;
  const normalized = normalizeDate(dateStr, false);
  if (!normalized) return null;
  const [y, m, d] = normalized.split('-').map(Number);
  return Date.UTC(y, m - 1, d, 23, 59, 59, 999);
}

async function parseJsonBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  if (typeof req.body === 'object') return req.body;
  return {};
}

function parseMediaUpload(body = {}) {
  if (!body.mediaFileData || !body.mediaFileName) return null;
  try {
    const buffer = Buffer.from(String(body.mediaFileData), 'base64');
    if (!buffer.length) return null;
    return {
      buffer,
      name: String(body.mediaFileName || 'upload.bin').replace(/[^a-zA-Z0-9._-]/g, '_'),
      mime: String(body.mediaFileMime || 'application/octet-stream')
    };
  } catch {
    return null;
  }
}

async function enrichEvents(events) {
  const cache = new Map();
  const resolveName = async (guildId, userId) => {
    const key = `${guildId}:${userId}`;
    if (!cache.has(key)) cache.set(key, getGuildMemberDisplayName(guildId, userId));
    return cache.get(key);
  };

  return Promise.all(events.map(async (event) => {
    const attendeesResolved = await Promise.all(Object.entries(event.attendees || {}).map(async ([id, attendee]) => ({
      id,
      name: await resolveName(event.guildId, id),
      role: attendee.role,
      className: attendee.class || ''
    })));

    const activityLogs = await Promise.all((event.activityLogs || []).map(async (entry) => ({
      ...entry,
      userName: entry?.userName || (entry?.userId ? await resolveName(event.guildId, entry.userId) : 'Unknown')
    })));

    const organizerName = event.organizerId ? await resolveName(event.guildId, event.organizerId) : '—';
    return { ...event, attendeesResolved, organizerName, activityLogs };
  }));
}


function targetChannelId(template, fallbackChannelId, preferredChannelId = null) {
  if (template === 'guild_event') return GUILD_EVENT_CHANNEL_ID;
  if (template === 'gvg') return GVG_EVENT_CHANNEL_ID;
  return preferredChannelId || fallbackChannelId;
}

async function syncEventMessage(event) {
  if (await hydrateAttendeeDisplayNames(event)) await saveEvent(event);
  try {
    if (!event.messageId) throw new Error('Discord API 404: {"message":"Unknown Message","code":10008}');
    await editChannelMessage(event.channelId, event.messageId, { embeds: [eventEmbed(event)], components: eventComponentsFor(event) });
  } catch (error) {
    const msg = String(error?.message || '');
    if (!msg.includes('10008') && !msg.toLowerCase().includes('unknown message')) throw error;
    const created = await sendChannelMessage(event.channelId, { embeds: [eventEmbed(event)], components: eventComponentsFor(event) });
    event.messageId = created.id;
    await saveEvent(event);
  }
}

async function archiveAndDeleteMessage(event) {
  event.archived = true;
  await saveEvent(event);

  await sendChannelMessage(ARCHIVE_LOG_CHANNEL_ID, {
    content: `🗃️ Event archivé: **${event.title}** (ID: \`${event.id}\`) — prévu pour <t:${Math.floor(event.startsAt / 1000)}:F> dans <#${event.channelId}>.`
  });

  for (const pingId of event.reminderMessageIds || []) {
    try { await deleteChannelMessage(event.channelId, pingId); } catch {}
  }
  try { await deleteChannelMessage(event.channelId, event.messageId); } catch {}
}

module.exports = async function handler(req, res) {
  if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: 'Unauthorized', hint: 'Use secret query or bearer token.' });

  try {
    if (req.method === 'GET') {
      const guildId = req.query?.guild_id;
      const only = req.query?.only || 'current';
      const all = await getAllEvents();
      let out = all;
      if (guildId) out = out.filter((e) => e.guildId === guildId);
      if (only === 'current') out = out.filter((e) => !e.archived);
      if (only === 'past') out = out.filter((e) => e.archived);
      out.sort((a, b) => b.createdAt - a.createdAt);
      const limited = out.slice(0, 200);
      const enriched = await enrichEvents(limited);
      return res.status(200).json({ ok: true, events: enriched });
    }

    if (req.method === 'POST') {
      const body = await parseJsonBody(req);
      const recurrence = ['none', 'daily', 'weekly', 'custom'].includes(body.recurrence) ? body.recurrence : 'none';
      const timezone = String(body.timezone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
      const startsAt = parseDate(body.date, body.time, recurrence === 'custom', timezone);
      if (!startsAt) return res.status(400).json({ ok: false, error: 'Invalid date/time. Use DD-MM-YYYY or today + HH:mm.' });

      const event = newEvent({
        guildId: body.guildId,
        channelId: targetChannelId(body.template, body.channelId, body.channelId),
        template: body.template,
        startsAt,
        recurrence,
        recurrenceDays: Array.isArray(body.recurrenceDays) ? body.recurrenceDays : [],
        recurrenceEndsAt: body.recurrence && body.recurrence !== 'none' ? (parseDateOnly(body.recurrenceEndsAt) || null) : null,
        mode: ['raid', 'social', 'announce'].includes(body.mode) ? body.mode : undefined,
        title: body.title || undefined,
        subtitle: body.subtitle || undefined,
        mediaUrl: /^https?:\/\//i.test(String(body.mediaUrl || '').trim()) ? String(body.mediaUrl).trim() : '',
        timezone,
        pingRoleIds: Array.isArray(body.pingRoleIds) ? body.pingRoleIds.map((x) => String(x).trim()).filter(Boolean) : []
      });
      event.organizerId = body.organizerId || null;
      event.createdVia = 'dashboard';
      event.pingMode = body.pingMode === 'roles' ? 'roles' : 'attendees';
      normalizeGuildEventPingRoles(event);
      if (await hydrateAttendeeDisplayNames(event)) await saveEvent(event);

      const mediaFile = parseMediaUpload(body);
      let message;
      if (mediaFile) {
        const embed = eventEmbed({ ...event, mediaUrl: `attachment://${mediaFile.name}` });
        message = await sendChannelMessageWithAttachment(event.channelId, { embeds: [embed], components: eventComponentsFor(event) }, mediaFile);
        event.mediaUrl = message?.attachments?.[0]?.url || event.mediaUrl;
      } else {
        message = await sendChannelMessage(event.channelId, { embeds: [eventEmbed(event)], components: eventComponentsFor(event) });
      }
      event.messageId = message.id;
      await saveEvent(event);
      return res.status(200).json({ ok: true, event });
    }

    if (req.method === 'PATCH') {
      const body = await parseJsonBody(req);
      const event = await getEvent(body.id);
      if (!event) return res.status(404).json({ ok: false, error: 'Event not found' });

      if (typeof body.timezone === 'string' && body.timezone.trim()) event.timezone = body.timezone.trim();
      if (body.time || body.date || body.recurrence === 'custom' || body.timezone) {
        const nextRec = body.recurrence || event.recurrence;
        const startsAt = parseDate(body.date ?? '', body.time ?? String(new Date(event.startsAt).toTimeString().slice(0, 5)), nextRec === 'custom', event.timezone || DEFAULT_TIMEZONE);
        if (!startsAt) return res.status(400).json({ ok: false, error: 'Invalid date/time.' });
        event.startsAt = startsAt;
      }
      if (body.recurrence) event.recurrence = body.recurrence;
      if (Array.isArray(body.recurrenceDays)) event.recurrenceDays = body.recurrenceDays;
      if (typeof body.subtitle === 'string') event.subtitle = body.subtitle;
      if (typeof body.mediaUrl === 'string') event.mediaUrl = /^https?:\/\//i.test(body.mediaUrl.trim()) ? body.mediaUrl.trim() : '';
      if (typeof body.title === 'string' && body.title.trim()) event.title = body.title.trim();
      if (typeof body.template === 'string' && body.template.trim()) event.template = body.template.trim();
      event.channelId = targetChannelId(event.template, event.channelId, body.channelId ? String(body.channelId).trim() : null);
      if (typeof body.mode === 'string' && ['raid', 'social', 'announce'].includes(body.mode)) event.mode = body.mode;
      if (typeof body.pingMode === 'string' && ['attendees', 'roles'].includes(body.pingMode)) event.pingMode = body.pingMode;
      normalizeGuildEventPingRoles(event);
      if (typeof body.organizerId === 'string') event.organizerId = body.organizerId || null;
      if (body.attendees && typeof body.attendees === 'object') event.attendees = body.attendees;
      if (Array.isArray(body.pingRoleIds)) event.pingRoleIds = body.pingRoleIds.map((x) => String(x).trim()).filter(Boolean);
      normalizeGuildEventPingRoles(event);
      if (body.recurrence === 'none') event.recurrenceEndsAt = null;
      if (Object.prototype.hasOwnProperty.call(body, 'recurrenceEndsAt')) event.recurrenceEndsAt = parseDateOnly(body.recurrenceEndsAt) || event.recurrenceEndsAt || null;

      if (await hydrateAttendeeDisplayNames(event)) await saveEvent(event);
      const mediaFile = parseMediaUpload(body);
      await saveEvent(event);
      if (mediaFile) {
        try {
          const embed = eventEmbed({ ...event, mediaUrl: `attachment://${mediaFile.name}` });
          const updated = await editChannelMessageWithAttachment(event.channelId, event.messageId, { embeds: [embed], components: eventComponentsFor(event) }, mediaFile);
          event.mediaUrl = updated?.attachments?.[0]?.url || event.mediaUrl;
          await saveEvent(event);
        } catch (error) {
          const msg = String(error?.message || '');
          if (!msg.includes('10008') && !msg.toLowerCase().includes('unknown message')) throw error;
          const created = await sendChannelMessageWithAttachment(event.channelId, { embeds: [eventEmbed({ ...event, mediaUrl: `attachment://${mediaFile.name}` })], components: eventComponentsFor(event) }, mediaFile);
          event.messageId = created.id;
          event.mediaUrl = created?.attachments?.[0]?.url || event.mediaUrl;
          await saveEvent(event);
        }
      } else {
        await syncEventMessage(event);
      }
      return res.status(200).json({ ok: true, event });
    }

    if (req.method === 'DELETE') {
      const event = await getEvent(req.query?.id);
      if (!event) return res.status(404).json({ ok: false, error: 'Event not found' });
      try {
        await archiveAndDeleteMessage(event);
        return res.status(200).json({ ok: true });
      } catch (error) {
        return res.status(500).json({ ok: false, error: `Archive/delete failed: ${error.message}` });
      }
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Unhandled error' });
  }
};
