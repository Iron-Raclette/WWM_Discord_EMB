const crypto = require('node:crypto');
const { newEvent, saveEvent, getEvent, getAllEvents, templates, saveDraft, getDraft, deleteDraft } = require('../lib/racletteEvents'); // To Change
const { sendChannelMessage, sendChannelMessageWithAttachment, editChannelMessage, deleteChannelMessage, getGuildMemberDisplayName } = require('../lib/discordApi');
const { eventButtons, templateButtons, guildEventModeButtons, classButtons, daySelectMenu, eventEmbed } = require('../lib/components');
const { getJson, setJson, mgetJson } = require('../lib/vercelStore');
const { commands } = require('../lib/commands');

const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;
const APP_URL = process.env.APP_URL || 'https://wwm-discord-emb.vercel.app/'; // Vercel URL
const CREATE_FLOW_TIMEOUT_MS = 2 * 60 * 1000;
const flowTimezoneByNonce = new Map();
const flowMediaUrlByNonce = new Map();
const flowMediaFileByNonce = new Map();
const flowScheduleByNonce = new Map();
const ARCHIVE_LOG_CHANNEL_ID = process.env.ARCHIVE_LOG_CHANNEL_ID || '1512519488208375828'; // ID TO CHANGE HERE
const DEFAULT_TIMEZONE = process.env.EVENT_TIMEZONE || 'Europe/Paris';
const WEEKDAY_INDEX = { dim: 0, lun: 1, mar: 2, mer: 3, jeu: 4, ven: 5, sam: 6 };
const GUILD_EVENT_CHANNEL_ID = process.env.GUILD_EVENT_CHANNEL_ID || '1512499011641413803';
const GVG_EVENT_CHANNEL_ID = process.env.GVG_EVENT_CHANNEL_ID || '1512520519973470290';
const EVENT_PING_ROLE_ID = process.env.EVENT_PING_ROLE_ID || '1512495672572641361';
const COMMAND_SYNC_TTL_MS = 15 * 60 * 1000;
const commandSyncByGuild = new Map();

async function ensureGuildCommandsRegistered(guildId) {
  if (!guildId) return;
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.CLIENT_ID;
  if (!token || !clientId) return;

  const now = Date.now();
  const last = commandSyncByGuild.get(guildId) || 0;
  if ((now - last) < COMMAND_SYNC_TTL_MS) return;
  commandSyncByGuild.set(guildId, now);

  try {
    await fetch(`https://discord.com/api/v10/applications/${clientId}/guilds/${guildId}/commands`, {
      method: 'PUT',
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(commands)
    });
  } catch {
    // no-op: command sync should never break interactions
  }
}


function eventChannelForTemplate(template, fallbackChannelId) {
  if (template === 'guild_event') return GUILD_EVENT_CHANNEL_ID;
  if (template === 'gvg') return GVG_EVENT_CHANNEL_ID;
  return fallbackChannelId;
}

function eventComponentsFor(event) {
  return eventButtons(event.id, !!event.archived, event.mode);
}

function actorDisplayName(member = {}) {
  return member?.nick || member?.user?.global_name || member?.user?.username || member?.user?.id || 'Unknown';
}

function appendEventActivityLog(event, entry = {}) {
  const next = {
    id: crypto.randomUUID(),
    ts: Date.now(),
    action: String(entry.action || 'update'),
    userId: entry.userId ? String(entry.userId) : '',
    userName: String(entry.userName || 'Unknown'),
    role: entry.role ? String(entry.role) : '',
    fromRole: entry.fromRole ? String(entry.fromRole) : '',
    className: entry.className ? String(entry.className) : '',
    source: 'bot-interaction'
  };
  event.activityLogs = [...(Array.isArray(event.activityLogs) ? event.activityLogs : []), next].slice(-1000);
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

function verifyDiscordRequest(req, rawBody) {
  if (process.env.DISCORD_SKIP_SIGNATURE_CHECK === 'true') return true;
  const signature = req.headers['x-signature-ed25519'];
  const timestamp = req.headers['x-signature-timestamp'];
  if (!signature || !timestamp || !PUBLIC_KEY) return false;
  try {
    const msg = Buffer.from(timestamp + rawBody);
    const sig = Buffer.from(signature, 'hex');
    const pub = Buffer.from(PUBLIC_KEY, 'hex');
    const keyObject = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), pub]), format: 'der', type: 'spki' });
    return crypto.verify(null, msg, keyObject, sig);
  } catch { return false; }
}

async function getRawAndParsedBody(req) {
  if (typeof req.body === 'string') return { rawBody: req.body, body: JSON.parse(req.body) };
  if (Buffer.isBuffer(req.body)) {
    const rawBody = req.body.toString('utf8');
    return { rawBody, body: JSON.parse(rawBody) };
  }
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) return { rawBody: JSON.stringify(req.body), body: req.body };
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  const rawBody = Buffer.concat(chunks).toString('utf8');
  return { rawBody, body: JSON.parse(rawBody) };
}

function json(res, body) {
  res.status(200);
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}
const interactionMessage = (content, components = [], ephemeral = false) => ({
  type: 4,
  data: {
    content,
    ...(components.length ? { components } : {}),
    ...(ephemeral ? { flags: 64 } : {})
  }
});
const privateMessage = (content, components = []) => interactionMessage(content, components, false);
const ephemeralMessage = (content, components = []) => interactionMessage(content, components, true);
const createFlowMessage = (content, components = []) => interactionMessage(`${content}${components.length ? '\n\n⏱️ Ce menu expire après 2 minutes sans action.' : ''}`, components, true);
const commandOption = (body, name) => body.data?.options?.find((opt) => opt.name === name)?.value;
const commandAttachment = (body, name) => {
  const attachmentId = body.data?.options?.find((opt) => opt.name === name)?.value;
  const entry = attachmentId ? body.data?.resolved?.attachments?.[attachmentId] : null;
  const url = entry?.url || '';
  if (!/^https?:\/\//i.test(url)) return null;
  return {
    url,
    name: String(entry?.filename || 'upload.bin').replace(/[^a-zA-Z0-9._-]/g, '_'),
    mime: String(entry?.content_type || 'application/octet-stream')
  };
};

function createFlowNonce(mediaUrl = '', mediaFile = null) {
  const nonce = `${Date.now().toString(36)}.${crypto.randomUUID().slice(0, 6)}`;
  setFlowTimezone(nonce, DEFAULT_TIMEZONE);
  setFlowMediaUrl(nonce, mediaUrl);
  setFlowMediaFile(nonce, mediaFile);
  initFlowSchedule(nonce);
  return nonce;
}


function setFlowTimezone(nonce, timezone) {
  if (!nonce) return;
  flowTimezoneByNonce.set(nonce, timezone || DEFAULT_TIMEZONE);
}

function getFlowTimezone(nonce) {
  return flowTimezoneByNonce.get(nonce) || DEFAULT_TIMEZONE;
}

function setFlowMediaUrl(nonce, mediaUrl) {
  if (!nonce) return;
  const value = /^https?:\/\//i.test(String(mediaUrl || '').trim()) ? String(mediaUrl).trim() : '';
  flowMediaUrlByNonce.set(nonce, value);
}

function setFlowMediaFile(nonce, mediaFile) {
  if (!nonce) return;
  if (!mediaFile || !/^https?:\/\//i.test(String(mediaFile.url || ''))) {
    flowMediaFileByNonce.delete(nonce);
    return;
  }
  flowMediaFileByNonce.set(nonce, {
    url: String(mediaFile.url),
    name: String(mediaFile.name || 'upload.bin').replace(/[^a-zA-Z0-9._-]/g, '_'),
    mime: String(mediaFile.mime || 'application/octet-stream')
  });
}

function getFlowMediaFile(nonce) {
  return flowMediaFileByNonce.get(nonce) || null;
}

async function downloadAttachment(mediaFile) {
  if (!mediaFile?.url) return null;
  try {
    const response = await fetch(mediaFile.url);
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (!buffer.length) return null;
    return { buffer, name: mediaFile.name, mime: mediaFile.mime };
  } catch {
    return null;
  }
}

function getFlowMediaUrl(nonce) {
  return flowMediaUrlByNonce.get(nonce) || '';
}

function initFlowSchedule(nonce) {
  const now = new Date();
  flowScheduleByNonce.set(nonce, {
    year: now.getFullYear(),
    month: now.getMonth(),
    day: now.getDate(),
    hour: 21,
    minute: 0,
    recurrence: 'none'
  });
}

function getFlowSchedule(nonce) {
  const cur = flowScheduleByNonce.get(nonce);
  if (cur) return cur;
  initFlowSchedule(nonce);
  return flowScheduleByNonce.get(nonce);
}

function setFlowSchedule(nonce, patch = {}) {
  const cur = getFlowSchedule(nonce);
  const next = { ...cur, ...patch };
  const daysInMonth = new Date(next.year, next.month + 1, 0).getDate();
  if (next.day > daysInMonth) next.day = daysInMonth;
  flowScheduleByNonce.set(nonce, next);
}

function flowCalendarText(schedule) {
  const { year, month, day } = schedule;
  const labels = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  const firstDay = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const out = [labels.join(' ')];
  let row = new Array(firstDay).fill('  ');
  for (let d = 1; d <= days; d += 1) {
    const mark = d === day ? '*' : ' ';
    row.push(`${String(d).padStart(2, '0')}${mark}`);
    if (row.length === 7) { out.push(row.join(' ')); row = []; }
  }
  if (row.length) {
    while (row.length < 7) row.push('  ');
    out.push(row.join(' '));
  }
  return out.join('\n');
}

function flowDateOptions(schedule, start, end) {
  const opts = [];
  for (let d = start; d <= end; d += 1) {
    const date = new Date(schedule.year, schedule.month, d);
    if (date.getMonth() !== schedule.month) break;
    const wd = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'][date.getDay()];
    opts.push({ label: `${wd} ${String(d).padStart(2, '0')}/${String(schedule.month + 1).padStart(2, '0')}`, value: String(d), default: d === schedule.day });
  }
  return opts;
}


function clearFlowNonce(nonce) {
  const key = String(nonce || '').trim();
  if (!key) return;
  flowTimezoneByNonce.delete(key);
  flowMediaUrlByNonce.delete(key);
  flowMediaFileByNonce.delete(key);
  flowScheduleByNonce.delete(key);
}

function scheduleComponents(nonce, template, subtype = '') {
  const s = getFlowSchedule(nonce);
  const hourLabel = String(s.hour).padStart(2, '0');
  const minuteLabel = String(s.minute).padStart(2, '0');
  const openId = `sched:open:${nonce}:${template}${subtype ? `:${subtype}` : ''}`;
  const rec = String(s.recurrence || 'none').toLowerCase();
  const recurrenceLabel = rec === 'daily' ? '🔁 Daily' : rec === 'weekly' ? '🔁 Weekly' : rec === 'custom' ? '🔁 Custom' : '🔁 None';
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 2, custom_id: `sched:month:${nonce}:prev`, label: '← Mois précédent' },
        { type: 2, style: 1, custom_id: `sched:month:${nonce}:next`, label: 'Mois suivant →' },
        { type: 2, style: 3, custom_id: openId, label: 'Choisir la date' },
        { type: 2, style: 2, custom_id: `sched:recurcycle:${nonce}:${subtype || 'default'}`, label: subtype === 'announce' ? '🔁 Weekly (fixe)' : recurrenceLabel, disabled: subtype === 'announce' }
      ]
    },
    {
      type: 1,
      components: [{
        type: 3,
        custom_id: `sched:daya:${nonce}`,
        placeholder: `Choisir la date (1–16)`,
        min_values: 1,
        max_values: 1,
        options: flowDateOptions(s, 1, 16)
      }]
    },
    {
      type: 1,
      components: [{
        type: 3,
        custom_id: `sched:dayb:${nonce}`,
        placeholder: `Choisir la date (17–31)`,
        min_values: 1,
        max_values: 1,
        options: flowDateOptions(s, 17, 31)
      }]
    },
    {
      type: 1,
      components: [{
        type: 3,
        custom_id: `sched:hour:${nonce}`,
        placeholder: `Heure: ${hourLabel}h`,
        min_values: 1,
        max_values: 1,
        options: Array.from({ length: 25 }, (_, h) => ({ label: `${String(h).padStart(2, '0')}h`, value: String(h), default: h === s.hour }))
      }]
    },
    {
      type: 1,
      components: [{
        type: 3,
        custom_id: `sched:minute:${nonce}`,
        placeholder: `Minutes: ${minuteLabel}`,
        min_values: 1,
        max_values: 1,
        options: [0, 15, 30, 45].map((m) => ({ label: `${String(m).padStart(2, '0')}mn`, value: String(m), default: m === s.minute }))
      }]
    }  ];
}

function schedulePrompt(nonce) {
  const s = getFlowSchedule(nonce);
  return `📅 **${new Date(s.year, s.month, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}**\n\`\`\`\n${flowCalendarText(s)}\n\`\`\`\n🕒 Heure sélectionnée: **${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}**`;
}

function scheduleUpdateData(nonce) {
  const s = getFlowSchedule(nonce);
  const template = s.template || 'donjon';
  const subtype = s.subtype || '';
  return {
    content: `Étape date/heure\n${schedulePrompt(nonce)}\n\n⏱️ Ce menu expire après 2 minutes sans action.`,
    components: scheduleComponents(nonce, template, subtype)
  };
}

function isExpiredFlowNonce(nonce) {
  const issuedAt = Number.parseInt(String(nonce || '').split('.')[0], 36);
  const expired = !Number.isFinite(issuedAt) || (Date.now() - issuedAt) > CREATE_FLOW_TIMEOUT_MS;
  if (expired) { flowTimezoneByNonce.delete(nonce); flowMediaUrlByNonce.delete(nonce); flowMediaFileByNonce.delete(nonce); flowScheduleByNonce.delete(nonce); }
  return expired;
}

function isExpiredDraft(draft) {
  return !draft || !draft.createdAt || (Date.now() - draft.createdAt) > CREATE_FLOW_TIMEOUT_MS;
}

function modalForTemplate(customId, title, announce = false, timezoneDefault = DEFAULT_TIMEZONE, mediaUrlDefault = '') {
  return {
    type: 9,
    data: {
      custom_id: customId,
      title,
      components: [
        { type: 1, components: [{ type: 4, custom_id: announce ? 'title' : 'subtitle', style: 1, label: announce ? 'Titre event' : 'Sous-titre (optionnel)', required: false, placeholder: announce ? 'Fête de guilde' : 'Raid normal + guilde' }] },
        { type: 1, components: [{ type: 4, custom_id: 'media_url', style: 1, label: 'Media URL (image/gif/webp) optionnel', required: false, value: mediaUrlDefault || '', placeholder: 'https://.../image.gif' }] }
      ]
    }
  };
}

function parseDateInput(dateInput, allowDefaultToday = false) {
  const value = String(dateInput || '').trim().toLowerCase();
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

function parseDateTime(dateInput, time, allowDefaultToday = false, timezone = DEFAULT_TIMEZONE) {
  if (!/^\d{2}:\d{2}$/.test(String(time || '').trim())) return null;
  const normalizedDate = parseDateInput(dateInput, allowDefaultToday);
  if (!normalizedDate) return null;
  return parseDateTimeInTimeZone(normalizedDate, time, timezone || DEFAULT_TIMEZONE);
}



function addMonth(year, month, delta) {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

function monthName(year, month) {
  return new Date(year, month, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

function recurrenceInstancesInMonth(event, monthStart, monthEnd) {
  const out = [];
  if (event.recurrence === 'none') {
    if (event.startsAt >= monthStart && event.startsAt <= monthEnd) out.push(event.startsAt);
    return out;
  }

  const stopAt = Math.min(event.recurrenceEndsAt || (monthEnd + 366 * 86400000), monthEnd);
  if (event.recurrence === 'daily') {
    for (let t = event.startsAt; t <= stopAt; t += 86400000) if (t >= monthStart) out.push(t);
    return out;
  }

  if (event.recurrence === 'weekly') {
    for (let t = event.startsAt; t <= stopAt; t += 7 * 86400000) if (t >= monthStart) out.push(t);
    return out;
  }

  if (event.recurrence === 'custom') {
    const wanted = new Set((event.recurrenceDays || []).map((d) => WEEKDAY_INDEX[d]).filter((d) => Number.isInteger(d)));
    if (!wanted.size) {
      if (event.startsAt >= monthStart && event.startsAt <= monthEnd) out.push(event.startsAt);
      return out;
    }
    for (let t = event.startsAt; t <= stopAt; t += 86400000) {
      if (t < monthStart) continue;
      if (wanted.has(new Date(t).getDay())) out.push(t);
    }
    return out;
  }

  return out;
}

async function buildMonthlyCalendarMessage(guildId, year, month) {
  const monthStart = new Date(year, month, 1).getTime();
  const monthEnd = new Date(year, month + 1, 1).getTime() - 1;
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const events = (await getAllEvents()).filter((e) => e.guildId === guildId && !e.archived);
  const byDay = new Map();
  for (const event of events) {
    for (const ts of recurrenceInstancesInMonth(event, monthStart, monthEnd)) {
      const d = new Date(ts).getDate();
      const list = byDay.get(d) || [];
      list.push({ title: event.title, ts, id: event.id });
      byDay.set(d, list);
    }
  }

  const header = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  const cellW = 5;
  const pad = (txt) => String(txt).slice(0, cellW).padEnd(cellW, ' ');

  const weekRows = [];
  let day = 1;
  for (let w = 0; w < 6; w += 1) {
    const row = [];
    for (let i = 0; i < 7; i += 1) {
      const index = (w * 7) + i;
      if (index < firstDay || day > daysInMonth) {
        row.push(pad(''));
      } else {
        const has = (byDay.get(day) || []).length > 0;
        row.push(pad(`${String(day).padStart(2, ' ')}${has ? '•' : ' '}`));
        day += 1;
      }
    }
    weekRows.push(row.join(' '));
    if (day > daysInMonth && w >= 4) break;
  }

  const calendarText = [
    header.map((h) => pad(h)).join(' '),
    ...weekRows
  ].join('\n');

  const details = [];
  const orderedDays = [...byDay.keys()].sort((a, b) => a - b);
  for (const d of orderedDays) {
    const items = byDay.get(d).sort((a, b) => a.ts - b.ts).slice(0, 4);
    const line = items
      .map((x) => `\`${new Date(x.ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}\` ${x.title}`)
      .join(' • ');
    details.push(`**${String(d).padStart(2, '0')}/${String(month + 1).padStart(2, '0')}** · ${line}`);
  }

  const ym = `${year}-${String(month + 1).padStart(2, '0')}`;
  return {
    embeds: [{
      title: `Calendrier — ${monthName(year, month)}`,
      description: `\`\`\n${calendarText}\n\`\`\n\n${details.length ? details.join('\n') : 'Aucun event ce mois-ci.'}`,
      color: 0x1f2a44,
      footer: { text: 'Vue mensuelle lisible • • = jours avec events • Utilise les flèches pour naviguer' }
    }],
    components: [{
      type: 1,
      components: [
        { type: 2, style: 2, custom_id: `calendar:prev:${ym}`, label: '← Mois précédent' },
        { type: 2, style: 1, custom_id: `calendar:current:${ym}`, label: 'Mois courant', disabled: true },
        { type: 2, style: 2, custom_id: `calendar:next:${ym}`, label: 'Mois suivant →' }
      ]
    }]
  };
}

async function archiveAndDeleteEventMessage(event) {
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

async function listActiveGuildEvents(guildId) {
  const events = await getAllEvents();
  return events.filter((e) => e.guildId === guildId && !e.archived).sort((a, b) => a.startsAt - b.startsAt).slice(0, 10);
}


const RANDOM_SCHEDULES_KEY = 'randomphrase:schedules';
const PHRASES_PENDING_KEY = 'config:phrases_pending';
const RANDOM_RECENT_WINDOW_MAX = 50;

const RANDOM_INTERVAL_MIN_MINUTES = 840;
const RANDOM_INTERVAL_MAX_MINUTES = 840;

function pickRandomIntervalMs(minMinutes = RANDOM_INTERVAL_MIN_MINUTES, maxMinutes = RANDOM_INTERVAL_MAX_MINUTES) {
  const lo = Math.max(1, Number(minMinutes) || RANDOM_INTERVAL_MIN_MINUTES);
  const hi = Math.max(lo, Number(maxMinutes) || RANDOM_INTERVAL_MAX_MINUTES);
  const minutes = lo + Math.floor(Math.random() * (hi - lo + 1));
  return minutes * 60 * 1000;
}


function normalizePhraseHistory(items = [], max) {
  return (items || []).map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 0).slice(0, max);
}

async function getRandomPhrase(guildId = 'global') {
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

async function startRandomSchedule(guildId, channelId, startedBy) {
  const schedules = await getJson(RANDOM_SCHEDULES_KEY, []);
  const now = Date.now();
  const nextRunAt = now + pickRandomIntervalMs();
  const kept = (Array.isArray(schedules) ? schedules : []).filter((s) => !(s.guildId === guildId && s.channelId === channelId));
  kept.push({ id: crypto.randomUUID(), guildId, channelId, startedBy, minIntervalMinutes: RANDOM_INTERVAL_MIN_MINUTES, maxIntervalMinutes: RANDOM_INTERVAL_MAX_MINUTES, nextRunAt, active: true, createdAt: now });
  await setJson(RANDOM_SCHEDULES_KEY, kept);
}

async function stopRandomSchedule(guildId, channelId) {
  const schedules = await getJson(RANDOM_SCHEDULES_KEY, []);
  const next = (Array.isArray(schedules) ? schedules : []).map((s) => (s.guildId === guildId && s.channelId === channelId ? { ...s, active: false, stoppedAt: Date.now() } : s));
  await setJson(RANDOM_SCHEDULES_KEY, next);
}

async function publishEventFromDraft(draft) {
  const event = newEvent({
    guildId: draft.guildId,
    channelId: draft.channelId,
    template: draft.template,
    startsAt: draft.startsAt,
    recurrence: draft.recurrence,
    recurrenceDays: draft.recurrenceDays || [],
    mode: draft.mode,
    title: draft.title,
    subtitle: draft.subtitle,
    mediaUrl: draft.mediaUrl || '',
    timezone: draft.timezone || DEFAULT_TIMEZONE,
    pingRoleIds: draft.pingRoleIds || []
  });
  event.organizerId = draft.organizerId;
  event.pingMode = draft.pingMode || 'attendees';

  const attachment = await downloadAttachment(draft.mediaFile);
  const message = attachment
    ? await sendChannelMessageWithAttachment(draft.channelId, { embeds: [eventEmbed({ ...event, mediaUrl: `attachment://${attachment.name}` })], components: eventComponentsFor(event) }, attachment)
    : await sendChannelMessage(draft.channelId, { embeds: [eventEmbed(event)], components: eventComponentsFor(event) });
  if (attachment) event.mediaUrl = message?.attachments?.[0]?.url || event.mediaUrl;
  event.messageId = message.id;
  await saveEvent(event);
  return event;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method not allowed');

  let rawBody; let body;
  try { ({ rawBody, body } = await getRawAndParsedBody(req)); } catch { return res.status(400).end('invalid json body'); }
  if (!verifyDiscordRequest(req, rawBody)) return res.status(401).json({ error: 'invalid request signature' });

  try {
  if (body.type === 1) return json(res, { type: 1 });

  if (body.type === 5) {
    const modalId = body.data?.custom_id || '';
    if (modalId === 'randomphrase:suggest_submit') {
      const rows = body.data?.components || [];
      const input = rows.flatMap((r) => r.components || []).find((c) => c.custom_id === 'random_phrase_text');
      const phrase = String(input?.value || '').trim();
      if (!phrase) return json(res, ephemeralMessage('Phrase vide.'));
      const pending = await getJson(PHRASES_PENDING_KEY, []);
      const entry = {
        id: crypto.randomUUID(),
        phrase,
        guildId: body.guild_id,
        channelId: body.channel_id,
        userId: body.member?.user?.id || '',
        userName: actorDisplayName(body.member),
        createdAt: Date.now(),
        status: 'pending'
      };
      const next = [entry, ...(Array.isArray(pending) ? pending : [])].slice(0, 500);
      await setJson(PHRASES_PENDING_KEY, next);
      return json(res, ephemeralMessage('✅ Suggestion envoyée pour validation dashboard.'));
    }
  }

  if (body.type === 2) {
    await ensureGuildCommandsRegistered(body.guild_id);
    const name = body.data?.name;
    if (['create-event', 'createevent'].includes(name)) {
      const cmdMedia = String(commandOption(body, 'media_url') || '').trim();
      const fileMedia = commandAttachment(body, 'media_file');
      const nonce = createFlowNonce(fileMedia?.url || cmdMedia, fileMedia);
      return json(res, createFlowMessage('Choisis une timezone (menu défilant, recherche par premières lettres), puis un template :', templateButtons(nonce, getFlowTimezone(nonce))));
    }
    if (name === 'setup-events') {
      await sendChannelMessage(body.channel_id, {
        embeds: [{
          title: '📆 Création rapide d\'event',
          description: 'Utilise le bouton ci-dessous pour lancer le formulaire de création.',
          color: 0x5865f2
        }],
        components: [{
          type: 1,
          components: [{ type: 2, style: 3, custom_id: 'createflow:start', label: '✨ CRÉER UN EVENT ✨' }]
        }]
      });
      return json(res, privateMessage('✅ Bouton publié.'));
    }
    if (name === 'my-events') {
      const list = await listActiveGuildEvents(body.guild_id);
      if (!list.length) return json(res, privateMessage('Aucun event actif.'));
      return json(res, privateMessage(list.map((e) => `• \`${e.id}\` — **${e.title}** — <t:${Math.floor(e.startsAt / 1000)}:F> — ${e.recurrence}`).join('\n')));
    }
    if (name === 'cancel-event') {
      const id = String(commandOption(body, 'event_id') || '').trim();
      const event = await getEvent(id);
      if (!event || event.guildId !== body.guild_id) return json(res, privateMessage('Event introuvable.'));
      const userId = body.member?.user?.id;
      if (!event.organizerId || event.organizerId !== userId) return json(res, ephemeralMessage('Seul l\'organisateur peut supprimer cet event.'));
      if (event.createdVia === 'dashboard') return json(res, ephemeralMessage('Cet event a été créé depuis le dashboard et ne peut être supprimé que depuis le dashboard.'));
      if (['weekly', 'custom'].includes(event.recurrence)) return json(res, ephemeralMessage('Les events weekly/custom se suppriment uniquement depuis le dashboard web.'));
      await archiveAndDeleteEventMessage(event);
      return json(res, privateMessage(`✅ Event \`${event.id}\` archivé et supprimé.`));
    }
    if (name === 'calendar') {
      const now = new Date();
      const payload = await buildMonthlyCalendarMessage(body.guild_id, now.getFullYear(), now.getMonth());
      await sendChannelMessage(body.channel_id, payload);
      return json(res, privateMessage('✅ Calendrier mensuel publié.'));
    }
    if (name === 'setup-calendar' || name === 'setupcalendar') {
      await sendChannelMessage(body.channel_id, {
        content: 'Clique pour afficher le calendrier mensuel des events :',
        components: [{ type: 1, components: [{ type: 2, style: 1, custom_id: 'calendar:open', label: '📅 Ouvrir calendrier mensuel' }] }]
      });
      return json(res, privateMessage('✅ Bouton calendrier publié.'));
    }
    if (name === 'dashboard') return json(res, privateMessage(`Dashboard web: ${APP_URL}/dashboard`));
    if (name === 'random-phrase') {
      const phrase = await getRandomPhrase(body.guild_id);
      if (!phrase) return json(res, privateMessage('Aucune phrase configurée dans le dashboard.'));
      await sendChannelMessage(body.channel_id, { content: String(phrase) });
      return json(res, privateMessage('✅ Phrase aléatoire envoyée.'));
    }
    if (name === 'setup-random') {
      await sendChannelMessage(body.channel_id, {
        content: 'Clique pour envoyer une phrase random :',
        components: [
          { type: 1, components: [{ type: 2, style: 3, custom_id: 'randomphrase:send', label: 'Envoyer une phrase random' }] }
        ]
      });
      return json(res, privateMessage('✅ Bouton random publié.'));
    }
    if (name === 'setup-proposer') {
      await sendChannelMessage(body.channel_id, {
        content: 'Clique pour proposer un LE SAVIEZ-VOUS :',
        components: [
          { type: 1, components: [{ type: 2, style: 3, custom_id: 'randomphrase:suggest_open', label: '✅ PROPOSER UN LE SAVIEZ-VOUS' }] }
        ]
      });
      return json(res, privateMessage('✅ Bouton proposer publié.'));
    }
    if (name === 'start-random') {
      await startRandomSchedule(body.guild_id, body.channel_id, body.member?.user?.id || '');
      return json(res, privateMessage('✅ Envoi auto activé: 1 phrase random toutes les 14 heures (jamais entre 23h et 9h heure FR) dans ce salon.'));
    }
    if (name === 'stop-random') {
      await stopRandomSchedule(body.guild_id, body.channel_id);
      return json(res, privateMessage('🛑 Envoi auto des phrases random arrêté dans ce salon.'));
    }
    if (name === 'purge-cache') return json(res, privateMessage('✅ Purge logique activée: les pings T-10/T0 des events passés sont supprimés automatiquement par le cron après 4h.'));
    return json(res, privateMessage('Commande inconnue.'));
  }

  if (body.type === 3) {
    const customId = body.data?.custom_id || '';
    if (customId === 'createflow:start') { const nonce = createFlowNonce(); return json(res, createFlowMessage('Choisis une timezone (menu défilant), puis un template. Pour un upload local, utilise /create-event avec media_file :', templateButtons(nonce, getFlowTimezone(nonce)))); }

    if (customId.startsWith('upload:hint:')) {
      return json(res, ephemeralMessage('📎 Upload local Discord : utilise la commande **/create-event** puis renseigne le champ **media_file** (pièce jointe). Le fichier sera réuploadé dans le message de l\'event.'));
    }

    if (customId.startsWith('flowtz:')) {
      const nonce = customId.split(':')[1];
      if (isExpiredFlowNonce(nonce)) return json(res, createFlowMessage('⌛ Menu expiré. Clique de nouveau sur **Créer event**.'));
      const selected = body.data?.values?.[0] || DEFAULT_TIMEZONE;
      setFlowTimezone(nonce, selected);
      return json(res, { type: 6 });
    }

    if (customId.startsWith('template:')) {
      const [, nonce, template] = customId.split(':');
      if (isExpiredFlowNonce(nonce)) return json(res, createFlowMessage('⌛ Menu expiré. Clique de nouveau sur **Créer event**.'));
      if (!templates[template]) return json(res, privateMessage('Template inconnu.'));
      if (template === 'guild_event') return json(res, createFlowMessage('Choisis le mode Guild Event :', guildEventModeButtons(nonce)));
      setFlowSchedule(nonce, { template, subtype: '' });
      return json(res, createFlowMessage(`Étape date/heure pour ${templates[template].title}\n${schedulePrompt(nonce)}`, scheduleComponents(nonce, template)));
    }

    if (customId.startsWith('guild:')) {
      const [, nonce, subtype] = customId.split(':');
      if (isExpiredFlowNonce(nonce)) return json(res, createFlowMessage('⌛ Menu expiré. Clique de nouveau sur **Créer event**.'));
      if (subtype === 'member') { setFlowSchedule(nonce, { template: 'guild_event', subtype: 'member' }); return json(res, createFlowMessage(`Étape date/heure pour Guild Event membres\n${schedulePrompt(nonce)}`, scheduleComponents(nonce, 'guild_event', 'member'))); }
      if (subtype === 'announce') { setFlowSchedule(nonce, { template: 'guild_event', subtype: 'announce', recurrence: 'weekly' }); return json(res, createFlowMessage(`Étape date/heure pour Guild Event récurrent rôles\n${schedulePrompt(nonce)}`, scheduleComponents(nonce, 'guild_event', 'announce'))); }
    }

    if (customId.startsWith('sched:month:')) {
      const [, , nonce, dir] = customId.split(':');
      if (isExpiredFlowNonce(nonce)) return json(res, createFlowMessage('⌛ Menu expiré. Clique de nouveau sur **Créer event**.'));
      const cur = getFlowSchedule(nonce);
      const d = new Date(cur.year, cur.month + (dir === 'prev' ? -1 : 1), 1);
      setFlowSchedule(nonce, { year: d.getFullYear(), month: d.getMonth() });
      return json(res, { type: 7, data: scheduleUpdateData(nonce) });
    }

    if (customId.startsWith('sched:daya:') || customId.startsWith('sched:dayb:')) {
      const nonce = customId.split(':')[2];
      if (isExpiredFlowNonce(nonce)) return json(res, createFlowMessage('⌛ Menu expiré. Clique de nouveau sur **Créer event**.'));
      const day = Number(body.data?.values?.[0]);
      if (Number.isFinite(day)) setFlowSchedule(nonce, { day });
      return json(res, { type: 7, data: scheduleUpdateData(nonce) });
    }

    if (customId.startsWith('sched:hour:')) {
      const nonce = customId.split(':')[2];
      if (isExpiredFlowNonce(nonce)) return json(res, createFlowMessage('⌛ Menu expiré. Clique de nouveau sur **Créer event**.'));
      const hour = Number(body.data?.values?.[0]);
      if (Number.isFinite(hour)) setFlowSchedule(nonce, { hour });
      return json(res, { type: 7, data: scheduleUpdateData(nonce) });
    }

    if (customId.startsWith('sched:minute:')) {
      const nonce = customId.split(':')[2];
      if (isExpiredFlowNonce(nonce)) return json(res, createFlowMessage('⌛ Menu expiré. Clique de nouveau sur **Créer event**.'));
      const minute = Number(body.data?.values?.[0]);
      if (Number.isFinite(minute)) setFlowSchedule(nonce, { minute });
      return json(res, { type: 7, data: scheduleUpdateData(nonce) });
    }

    if (customId.startsWith('sched:recurcycle:')) {
      const parts = customId.split(':');
      const nonce = parts[2];
      const subtype = parts[3] || '';
      if (isExpiredFlowNonce(nonce)) return json(res, createFlowMessage('⌛ Menu expiré. Clique de nouveau sur **Créer event**.'));
      if (subtype === 'announce') return json(res, { type: 6 });
      const order = ['none', 'daily', 'weekly', 'custom'];
      const current = String(getFlowSchedule(nonce).recurrence || 'none').toLowerCase();
      const idx = order.indexOf(current);
      const next = order[(idx + 1) % order.length] || 'none';
      setFlowSchedule(nonce, { recurrence: next });
      return json(res, { type: 7, data: scheduleUpdateData(nonce) });
    }

    if (customId.startsWith('sched:open:')) {
      const [, , nonce, template, subtype] = customId.split(':');
      if (isExpiredFlowNonce(nonce)) return json(res, createFlowMessage('⌛ Menu expiré. Clique de nouveau sur **Créer event**.'));
      const announce = template === 'guild_event' && subtype === 'announce';
      return json(res, modalForTemplate(`create:${nonce}:${template}${subtype ? `:${subtype}` : ''}`, `Créer ${templates[template]?.title || 'event'}`, announce, getFlowTimezone(nonce), getFlowMediaUrl(nonce)));
    }

    if (customId.startsWith('daysel:')) {
      const draft = await getDraft(customId.split(':')[1]);
      if (isExpiredDraft(draft)) return json(res, createFlowMessage('⌛ Draft expiré. Relance la création avec **Créer event**.'));
      draft.recurrenceDays = body.data.values || [];
      await saveDraft(draft);
      return json(res, { type: 6 });
    }

    if (customId.startsWith('dayconfirm:')) {
      const draftId = customId.split(':')[1];
      const draft = await getDraft(draftId);
      if (isExpiredDraft(draft)) return json(res, createFlowMessage('⌛ Draft expiré. Relance la création avec **Créer event**.'));
      if (!draft.recurrenceDays?.length) return json(res, createFlowMessage('Choisis au moins un jour.', daySelectMenu(draftId, [])));
      const event = await publishEventFromDraft(draft);
      await deleteDraft(draftId);
      clearFlowNonce(draft.nonce);
      return json(res, createFlowMessage(`✅ ${event.title} créé pour <t:${Math.floor(event.startsAt / 1000)}:F>. ID: \`${event.id}\``));
    }

    if (customId.startsWith('eventdelete:')) {
      const eventId = customId.split(':')[1];
      const event = await getEvent(eventId);
      if (!event || event.archived) return json(res, privateMessage('Event introuvable ou déjà archivé.'));
      const userId = body.member?.user?.id;
      if (!event.organizerId || userId !== event.organizerId) return json(res, ephemeralMessage('Seul l\'organisateur peut supprimer cet event.'));
      if (event.createdVia === 'dashboard') return json(res, ephemeralMessage('Cet event a été créé depuis le dashboard et ne peut être supprimé que depuis le dashboard.'));
      if (['weekly', 'custom'].includes(event.recurrence)) return json(res, ephemeralMessage('Les events weekly/custom se suppriment uniquement depuis le dashboard web.'));

      await archiveAndDeleteEventMessage(event);
      return json(res, privateMessage('✅ Event archivé et supprimé.'));
    }

    if (customId === 'randomphrase:send') {
      const phrase = await getRandomPhrase(body.guild_id);
      if (!phrase) return json(res, ephemeralMessage('Aucune phrase configurée.'));
      await sendChannelMessage(body.channel_id, { content: String(phrase) });
      return json(res, { type: 6 });
    }

    if (customId === 'randomphrase:suggest_open') {
      return json(res, {
        type: 9,
        data: {
          custom_id: 'randomphrase:suggest_submit',
          title: 'Proposer un LE SAVIEZ-VOUS',
          components: [{
            type: 1,
            components: [{
              type: 4,
              custom_id: 'random_phrase_text',
              style: 2,
              label: 'Ta proposition',
              min_length: 5,
              max_length: 250,
              required: true,
              placeholder: 'Ex: Le Saviez-vous ? ...'
            }]
          }]
        }
      });
    }

    if (customId === 'calendar:open') {
      const now = new Date();
      const payload = await buildMonthlyCalendarMessage(body.guild_id, now.getFullYear(), now.getMonth());
      return json(res, { type: 4, data: payload });
    }

    if (customId.startsWith('calendar:prev:') || customId.startsWith('calendar:next:')) {
      const [, dir, ym] = customId.split(':');
      const [yRaw, mRaw] = String(ym || '').split('-');
      const year = Number(yRaw);
      const month = Number(mRaw) - 1;
      if (!Number.isFinite(year) || !Number.isFinite(month) || month < 0 || month > 11) return json(res, { type: 6 });
      const target = addMonth(year, month, dir === 'prev' ? -1 : 1);
      const payload = await buildMonthlyCalendarMessage(body.guild_id, target.year, target.month);
      return json(res, { type: 7, data: payload });
    }

    if (customId.startsWith('role:')) {
      const [, eventId, role] = customId.split(':');
      const event = await getEvent(eventId);
      if (!event || event.archived) return json(res, privateMessage('Event introuvable ou archivé.'));
      const hydrated = await hydrateAttendeeDisplayNames(event);
      if (hydrated) await saveEvent(event);
      if (event.mode === 'announce') return json(res, ephemeralMessage('Event informatif: Ping à T-10 et au démarrage @Event Ping.'));
      const raidMode = !['social', 'announce'].includes(event.mode);
      const userId = body.member.user.id;
      const userName = actorDisplayName(body.member);
      const previousRole = event.attendees[userId]?.role || '';
      if (role === 'unregister') {
        delete event.attendees[userId];
        appendEventActivityLog(event, { action: 'unregister', userId, userName, fromRole: previousRole });
        await saveEvent(event);
        await editChannelMessage(event.channelId, event.messageId, { embeds: [eventEmbed(event)], components: eventComponentsFor(event) });
        return json(res, ephemeralMessage('✅ Tu as été désinscrit de l\'event.'));
      }

      let finalRole = role;
      if (raidMode && ['tank', 'dps', 'healer'].includes(role)) {
        const active = Object.values(event.attendees).filter((x) => ['tank', 'dps', 'healer'].includes(x.role) || (x.role === 'pending_spec' && ['tank', 'dps', 'healer'].includes(x.desiredRole))).length;
        finalRole = event.capacity != null && active >= event.capacity ? 'bench' : role;
      }

      if (raidMode && ['dps', 'tank', 'healer'].includes(finalRole)) {
        event.attendees[userId] = { userId, role: 'pending_spec', desiredRole: finalRole, class: null, displayName: userName };
        appendEventActivityLog(event, { action: 'register-pending-spec', userId, userName, role: finalRole, fromRole: previousRole });
        await saveEvent(event);
        await editChannelMessage(event.channelId, event.messageId, { embeds: [eventEmbed(event)], components: eventComponentsFor(event) });
        return json(res, ephemeralMessage('⚠️ Choix de spécialisation obligatoire pour valider ton inscription.', classButtons(event.id, finalRole)));
      }

      event.attendees[userId] = { userId, role: finalRole, class: null, displayName: userName };
      appendEventActivityLog(event, { action: finalRole === 'bench' ? 'bench' : 'register', userId, userName, role: finalRole, fromRole: previousRole });
      await saveEvent(event);
      await editChannelMessage(event.channelId, event.messageId, { embeds: [eventEmbed(event)], components: eventComponentsFor(event) });
      return json(res, ephemeralMessage(`Inscription enregistrée dans ${finalRole}.`));
    }

    if (customId.startsWith('class:')) {
      const [, eventId, role, encoded] = customId.split(':');
      const event = await getEvent(eventId);
      if (!event) return json(res, privateMessage('Event introuvable.'));
      const hydrated = await hydrateAttendeeDisplayNames(event);
      if (hydrated) await saveEvent(event);
      const existing = event.attendees[body.member.user.id];
      if (existing && existing.role === 'pending_spec' && existing.desiredRole && existing.desiredRole !== role) return json(res, ephemeralMessage('La spécialisation choisie ne correspond pas au rôle sélectionné.'));
      const className = Buffer.from(encoded, 'base64url').toString('utf8');
      event.attendees[body.member.user.id] = { userId: body.member.user.id, role, class: className, displayName: actorDisplayName(body.member) };
      appendEventActivityLog(event, { action: 'select-class', userId: body.member.user.id, userName: actorDisplayName(body.member), role, className, fromRole: existing?.desiredRole || existing?.role || '' });
      await saveEvent(event);
      await editChannelMessage(event.channelId, event.messageId, { embeds: [eventEmbed(event)], components: eventComponentsFor(event) });
      return json(res, { type: 6 });
    }
  }

  if (body.type === 5) {
    const customId = body.data?.custom_id || '';
    if (!customId.startsWith('create:')) return json(res, privateMessage('Modal inconnue.'));
    const parts = customId.split(':');
    const nonce = parts[1];
    const template = parts[2];
    const subtype = parts[3] || null;
    if (isExpiredFlowNonce(nonce)) return json(res, createFlowMessage('⌛ Formulaire expiré. Clique de nouveau sur **Créer event**.'));

    const values = Object.fromEntries(body.data.components.map((row) => [row.components[0].custom_id, row.components[0].value]));
    const timezone = String(getFlowTimezone(nonce) || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
    const sch = getFlowSchedule(nonce);
    const dateText = `${String(sch.day).padStart(2, '0')}-${String(sch.month + 1).padStart(2, '0')}-${sch.year}`;
    const timeText = `${String(sch.hour).padStart(2, '0')}:${String(sch.minute).padStart(2, '0')}`;
    const startsAt = parseDateTime(dateText, timeText, false, timezone);
    if (!startsAt || startsAt <= Date.now()) return json(res, createFlowMessage('Date/heure invalide ou passée.'));

    let mode = templates[template]?.mode || 'raid';
    let title = templates[template]?.title;
    let subtitle = values.subtitle || '';
    const mediaInput = String(values.media_url || getFlowMediaUrl(nonce) || '').trim();
    const mediaUrl = /^https?:\/\//i.test(mediaInput) ? mediaInput : '';
    const mediaFile = getFlowMediaFile(nonce);
    let pingMode = 'attendees';
    let recurrence = String(sch.recurrence || 'none').toLowerCase();
    if (!['none', 'daily', 'weekly', 'custom'].includes(recurrence)) recurrence = 'none';

    if (template === 'guild_event' && subtype === 'member') mode = 'social';
    if (template === 'guild_event' && subtype === 'announce') {
      mode = 'announce';
      title = values.title || 'Guild Event';
      subtitle = '';
      pingMode = 'roles';
      recurrence = 'weekly';
    }

    if (recurrence === 'custom') {
      const draft = await saveDraft({ guildId: body.guild_id, channelId: eventChannelForTemplate(template, body.channel_id), template, startsAt, recurrence, recurrenceDays: [], organizerId: body.member?.user?.id, mode, title, subtitle, mediaUrl, mediaFile, pingMode, pingRoleIds: pingMode === 'roles' ? [EVENT_PING_ROLE_ID] : [], timezone, nonce, createdAt: Date.now() });
      return json(res, createFlowMessage('Choisis les jours (Lun→Dim), puis confirme.', daySelectMenu(draft.id, [])));
    }

    const event = newEvent({ guildId: body.guild_id, channelId: eventChannelForTemplate(template, body.channel_id), template, startsAt, recurrence, mode, title, subtitle, mediaUrl, timezone });
    event.organizerId = body.member?.user?.id;
    event.pingMode = pingMode;
    if (pingMode === 'roles') event.pingRoleIds = [EVENT_PING_ROLE_ID];
    const attachment = await downloadAttachment(mediaFile);
    const message = attachment
      ? await sendChannelMessageWithAttachment(event.channelId, { embeds: [eventEmbed({ ...event, mediaUrl: `attachment://${attachment.name}` })], components: eventComponentsFor(event) }, attachment)
      : await sendChannelMessage(event.channelId, { embeds: [eventEmbed(event)], components: eventComponentsFor(event) });
    if (attachment) event.mediaUrl = message?.attachments?.[0]?.url || event.mediaUrl;
    event.messageId = message.id;
    await saveEvent(event);

    clearFlowNonce(nonce);
    return json(res, createFlowMessage(`✅ ${event.title} créé pour <t:${Math.floor(event.startsAt / 1000)}:F> (${event.recurrence}). ID: \`${event.id}\``));
  }

  return json(res, privateMessage('Interaction non gérée.'));
  } catch (error) {
    return json(res, createFlowMessage(`❌ Erreur: ${error.message || 'interaction failed'}`));
  }
};
