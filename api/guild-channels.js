const { getGuildTextChannels } = require('../lib/discordApi');

function isAuthorized(req) {
  const secret = process.env.DASHBOARD_SECRET || process.env.COMMANDS_SECRET || process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.authorization === `Bearer ${secret}` || req.query?.secret === secret;
}

module.exports = async function handler(req, res) {
  if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const guildId = req.query?.guild_id || process.env.DEFAULT_GUILD_ID;
  if (!guildId) return res.status(400).json({ ok: false, error: 'Missing guild_id' });

  try {
    const channels = await getGuildTextChannels(guildId);
    return res.status(200).json({ ok: true, channels });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Unhandled error' });
  }
};
