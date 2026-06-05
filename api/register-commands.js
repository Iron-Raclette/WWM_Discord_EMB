const API = 'https://discord.com/api/v10';
const { commands } = require('../lib/commands');

function isAuthorized(req) {
  const secret = process.env.COMMANDS_SECRET || process.env.CRON_SECRET;
  if (!secret) return false;

  const auth = req.headers.authorization;
  if (auth === `Bearer ${secret}`) return true;

  if (req.query?.secret === secret) return true;
  return false;
}

module.exports = async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({
      ok: false,
      error: 'Unauthorized',
      hint: 'Call with Authorization: Bearer <COMMANDS_SECRET> OR ?secret=<COMMANDS_SECRET>. Falls back to CRON_SECRET if COMMANDS_SECRET is unset.'
    });
  }

  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.CLIENT_ID;
  const guildId = req.query?.guild_id || process.env.GUILD_ID;

  if (!token || !clientId) {
    return res.status(500).json({
      ok: false,
      error: 'Missing env vars',
      hint: 'Set DISCORD_TOKEN and CLIENT_ID in Vercel environment variables.'
    });
  }

  const route = guildId
    ? `${API}/applications/${clientId}/guilds/${guildId}/commands`
    : `${API}/applications/${clientId}/commands`;

  const discordRes = await fetch(route, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(commands)
  });

  const payloadText = await discordRes.text();

  if (!discordRes.ok) {
    return res.status(discordRes.status).json({
      ok: false,
      error: 'Discord API error',
      route,
      details: payloadText
    });
  }

  let payload = [];
  try {
    payload = JSON.parse(payloadText);
  } catch {
    payload = [];
  }

  return res.status(200).json({
    ok: true,
    scope: guildId ? 'guild' : 'global',
    guildId: guildId || null,
    registered: payload.map((cmd) => cmd.name),
    note: 'guild scope appears almost instantly; global can take up to 1h in Discord clients.'
  });
};
