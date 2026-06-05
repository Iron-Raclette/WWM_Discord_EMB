const { getJson, setJson, mgetJson } = require('../lib/vercelStore');

const SETTINGS_KEY = 'config:settings';
const TEMPLATES_KEY = 'config:templates';
const PHRASES_KEY = 'config:phrases';
const PHRASES_PENDING_KEY = 'config:phrases_pending';

const defaultSettings = { // ID TO CHANGE HERE
  guildId: process.env.DEFAULT_GUILD_ID || '1512143388940566588', // Discord Server ID? -- Current ID = Useless Channel Test
  channelId: process.env.DEFAULT_CHANNEL_ID || '1512143389859250301', //General Channel?
  guildEventChannelId: process.env.GUILD_EVENT_CHANNEL_ID || '1512499011641413803',
  timezone: process.env.EVENT_TIMEZONE || 'Europe/Paris',
  archiveLogChannelId: process.env.ARCHIVE_LOG_CHANNEL_ID || '1512519488208375828',
  eventPingRoleId: process.env.EVENT_PING_ROLE_ID || '1512495672572641361',
  tempVocalTriggerChannelId: '1512143389859250302',
  gvgFixedPlayers: [],
  gvgRotatingPlayers: []
};


function sanitizeSettings(settings = {}) {
  const next = { ...settings };
  delete next.membreRoleId;
  delete next.apprentiRoleId;
  if (!next.eventPingRoleId) next.eventPingRoleId = process.env.EVENT_PING_ROLE_ID || '1512495672572641361'; // ID TO CHANGE HERE - PING ROLE
  return next;
}



function normalizePhrase(value) {
  return String(value || '').trim();
}

function normalizePhrases(list = []) {
  return (Array.isArray(list) ? list : []).map(normalizePhrase).filter(Boolean);
}

function isAuthorized(req) {
  const secret = process.env.DASHBOARD_SECRET || process.env.COMMANDS_SECRET || process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.authorization === `Bearer ${secret}` || req.query?.secret === secret;
}

module.exports = async function handler(req, res) {
  if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  try {
    if (req.method === 'GET') {
      const [settingsRaw, templatesRaw, phrasesRaw, pendingRaw] = await mgetJson([
        SETTINGS_KEY,
        TEMPLATES_KEY,
        PHRASES_KEY,
        PHRASES_PENDING_KEY
      ]);
      const merged = sanitizeSettings({ ...defaultSettings, ...((settingsRaw && typeof settingsRaw === 'object') ? settingsRaw : {}) });
      const templates = Array.isArray(templatesRaw) ? templatesRaw : [];
      const phrases = Array.isArray(phrasesRaw) ? phrasesRaw : [];
      const phrasesPending = Array.isArray(pendingRaw) ? pendingRaw : [];
      return res.status(200).json({ ok: true, settings: merged, templates, phrases, phrasesPending });
    }

    if (req.method === 'PATCH') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      if (body.settings && typeof body.settings === 'object') {
        const current = sanitizeSettings(await getJson(SETTINGS_KEY, defaultSettings));
        await setJson(SETTINGS_KEY, sanitizeSettings({ ...current, ...body.settings }));
      }
      if (Array.isArray(body.templates)) await setJson(TEMPLATES_KEY, body.templates);
      if (Array.isArray(body.phrases)) await setJson(PHRASES_KEY, normalizePhrases(body.phrases));

      if (body.approvePhraseId || body.rejectPhraseId) {
        const approveId = body.approvePhraseId ? String(body.approvePhraseId) : '';
        const rejectId = body.rejectPhraseId ? String(body.rejectPhraseId) : '';
        const [pendingRaw, phrasesRaw] = await mgetJson([PHRASES_PENDING_KEY, PHRASES_KEY]);
        const list = Array.isArray(pendingRaw) ? pendingRaw : [];
        const approved = list.find((p) => String(p?.id || '') === approveId);
        const nextPending = list.filter((p) => {
          const id = String(p?.id || '');
          if (approveId && id === approveId) return false;
          if (rejectId && id === rejectId) return false;
          return true;
        });
        if (approved?.phrase) {
          const phrases = normalizePhrases(phrasesRaw);
          phrases.push(normalizePhrase(approved.phrase));
          await setJson(PHRASES_KEY, normalizePhrases(phrases));
        }
        await setJson(PHRASES_PENDING_KEY, nextPending);
      }

      if (Array.isArray(body.phrasesPending)) await setJson(PHRASES_PENDING_KEY, body.phrasesPending);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Unhandled error' });
  }
};
