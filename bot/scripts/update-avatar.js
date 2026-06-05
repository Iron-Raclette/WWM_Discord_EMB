#!/usr/bin/env node
const fs = require('node:fs/promises');
const path = require('node:path');

const API = 'https://discord.com/api/v10';
const token = process.env.DISCORD_TOKEN;
const inputArg = process.argv[2] || path.join(__dirname, '..', '..', 'static', 'img', 'logo.png');

if (!token) {
  throw new Error('Missing DISCORD_TOKEN');
}

function extToMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  throw new Error(`Unsupported avatar extension: ${ext}. Use png/jpg/webp/gif.`);
}

(async () => {
  const absPath = path.resolve(process.cwd(), inputArg);
  const buffer = await fs.readFile(absPath);
  const mime = extToMime(absPath);
  const avatar = `data:${mime};base64,${buffer.toString('base64')}`;

  const res = await fetch(`${API}/users/@me`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ avatar })
  });

  const raw = await res.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch {}

  if (!res.ok) {
    throw new Error(`Discord API failed (${res.status}): ${raw}`);
  }

  console.log(`✅ Bot avatar updated: ${data.username || 'unknown'} (${data.id || 'no-id'})`);
  console.log(`Source image: ${absPath}`);
})();
