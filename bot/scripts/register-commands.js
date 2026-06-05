const API = 'https://discord.com/api/v10';
const { commands } = require('../../lib/commands');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || !clientId) {
  throw new Error('Missing DISCORD_TOKEN or CLIENT_ID');
}

async function run() {
  const route = guildId
    ? `${API}/applications/${clientId}/guilds/${guildId}/commands`
    : `${API}/applications/${clientId}/commands`;

  const res = await fetch(route, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(commands)
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }

  console.log('Commands registered:', commands.map((x) => `/${x.name}`).join(', '));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
