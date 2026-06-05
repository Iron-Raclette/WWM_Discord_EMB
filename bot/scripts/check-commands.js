const API = 'https://discord.com/api/v10';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || !clientId) {
  throw new Error('Missing DISCORD_TOKEN or CLIENT_ID');
}

async function api(path) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bot ${token}` }
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

async function run() {
  const globalCommands = await api(`/applications/${clientId}/commands`);
  console.log('\nGlobal commands:');
  if (!globalCommands.length) console.log('- (none)');
  for (const c of globalCommands) console.log(`- /${c.name}`);

  if (guildId) {
    const guildCommands = await api(`/applications/${clientId}/guilds/${guildId}/commands`);
    console.log(`\nGuild commands (${guildId}):`);
    if (!guildCommands.length) console.log('- (none)');
    for (const c of guildCommands) console.log(`- /${c.name}`);
  } else {
    console.log('\nNo GUILD_ID set: guild-specific command check skipped.');
  }
}

run().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
