const API_BASE = 'https://discord.com/api/v10';
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN;

async function discord(path, options = {}) {
  if (!BOT_TOKEN) throw new Error('DISCORD_BOT_TOKEN missing (or DISCORD_TOKEN)');
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bot ${BOT_TOKEN}`,
      ...(options.headers || {})
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord API ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}


function alignEmbedAttachmentUrls(payload, fileName) {
  if (!Array.isArray(payload?.embeds) || !fileName) return payload;
  const embeds = payload.embeds.map((embed) => {
    if (!embed || typeof embed !== 'object') return embed;
    const imageUrl = String(embed?.image?.url || '');
    if (!/^attachment:\/\//i.test(imageUrl)) return embed;
    return {
      ...embed,
      image: {
        ...(embed.image || {}),
        url: `attachment://${fileName}`
      }
    };
  });
  return { ...payload, embeds };
}

async function discordMultipart(path, method, payload, file) {
  if (!BOT_TOKEN) throw new Error('DISCORD_BOT_TOKEN missing (or DISCORD_TOKEN)');
  const fileName = String(file?.name || 'upload.bin');
  const payloadWithAlignedEmbeds = alignEmbedAttachmentUrls(payload || {}, fileName);
  const normalizedPayload = {
    ...payloadWithAlignedEmbeds,
    attachments: Array.isArray(payloadWithAlignedEmbeds?.attachments) && payloadWithAlignedEmbeds.attachments.length
      ? payloadWithAlignedEmbeds.attachments
      : [{ id: 0, filename: fileName }]
  };

  const form = new FormData();
  form.append('payload_json', JSON.stringify(normalizedPayload));
  form.append('files[0]', new Blob([file.buffer], { type: file.mime || 'application/octet-stream' }), fileName);

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bot ${BOT_TOKEN}`
    },
    body: form
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord API ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function sendChannelMessage(channelId, payload) {
  return discord(`/channels/${channelId}/messages`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

async function sendChannelMessageWithAttachment(channelId, payload, file) {
  return discordMultipart(`/channels/${channelId}/messages`, 'POST', payload, file);
}

async function editChannelMessage(channelId, messageId, payload) {
  return discord(`/channels/${channelId}/messages/${messageId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

async function editChannelMessageWithAttachment(channelId, messageId, payload, file) {
  return discordMultipart(`/channels/${channelId}/messages/${messageId}`, 'PATCH', payload, file);
}

async function deleteChannelMessage(channelId, messageId) {
  return discord(`/channels/${channelId}/messages/${messageId}`, { method: 'DELETE' });
}

async function getGuildMemberDisplayName(guildId, userId) {
  try {
    const member = await discord(`/guilds/${guildId}/members/${userId}`);
    return member?.nick || member?.user?.global_name || member?.user?.username || userId;
  } catch {
    return userId;
  }
}


async function updateBotAvatarDataUrl(avatarDataUrl) {
  return discord('/users/@me', {
    method: 'PATCH',
    body: JSON.stringify({ avatar: avatarDataUrl })
  });
}

async function getGuildTextChannels(guildId) {
  const channels = await discord(`/guilds/${guildId}/channels`);
  return (channels || [])
    .filter((ch) => [0, 5].includes(ch.type))
    .sort((a, b) => (a.position || 0) - (b.position || 0))
    .map((ch) => ({ id: ch.id, name: ch.name, type: ch.type }));
}

module.exports = {
  sendChannelMessage,
  sendChannelMessageWithAttachment,
  editChannelMessage,
  editChannelMessageWithAttachment,
  deleteChannelMessage,
  getGuildMemberDisplayName,
  getGuildTextChannels,
  updateBotAvatarDataUrl
};
