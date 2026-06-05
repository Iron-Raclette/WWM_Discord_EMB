const { updateBotAvatarDataUrl } = require('../lib/discordApi');

function isAuthorized(req) {
  const secret = process.env.DASHBOARD_SECRET || process.env.COMMANDS_SECRET || process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.authorization === `Bearer ${secret}` || req.query?.secret === secret;
}

module.exports = async function handler(req, res) {
  if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: 'Unauthorized' });

  if (req.method !== 'PATCH') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const dataUrl = String(body.avatarDataUrl || '').trim();
    if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(dataUrl)) {
      return res.status(400).json({ ok: false, error: 'Invalid avatarDataUrl (expect data:image/<type>;base64,...)' });
    }

    const user = await updateBotAvatarDataUrl(dataUrl);
    return res.status(200).json({ ok: true, user: { id: user?.id, username: user?.username, avatar: user?.avatar } });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Unhandled error' });
  }
};
