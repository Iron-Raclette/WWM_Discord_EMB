const { templates } = require('./racletteEvents'); //TO CHANGE

// Expected custom emoji names on server: Tanklogo, BellstrikeUmbra, Healer, SilkbindJade, StonesplitMight, DPS, BamboocutWind, SilkbindDeluge, BellstrikeSplendor
const emojiIds = { // ID TO CHANGE
  Tanklogo: '1512524503488528405',
  DPS: '1512524541329408101',
  Healer: '1512524524988665866',
  BellstrikeSplendor: '1512524595725340892',
  BellstrikeUmbra: '1512524614926860418',
  BamboocutWind: '1512524577996017804',
  BamboocutBurst: '1512524558471528568',
  SilkbindJade: '1512524692442054777',
  SilkbindDeluge: '1512524675740336178',
  StonesplitMight: '1512524708497723492',
  StonesplitStrength: '1512524724817629305'
};

function customEmoji(name, fallback) {
  const id = emojiIds[name];
  return id ? { id, name } : { name: fallback };
}

const specIcons = {
  'Stonesplit Might': `<:StonesplitMight:${emojiIds.StonesplitMight}>`,
  'Stonesplit Strength': `<:StonesplitStrength:${emojiIds.StonesplitStrength}>`,
  'Bellstrike Splendor': `<:BellstrikeSplendor:${emojiIds.BellstrikeSplendor}>`,
  'Bellstrike Umbra': `<:BellstrikeUmbra:${emojiIds.BellstrikeUmbra}>`,
  'Bamboocut Wind': `<:BamboocutWind:${emojiIds.BamboocutWind}>`,
  'Bamboocut Burst': `<:BamboocutBurst:${emojiIds.BamboocutBurst}>`,
  'Silkbind Jade': `<:SilkbindJade:${emojiIds.SilkbindJade}>`,
  'Silkbind Deluge': `<:SilkbindDeluge:${emojiIds.SilkbindDeluge}>`
};

function withDeleteButton(rows, eventId, disabled = false) {
  return [
    ...rows,
    {
      type: 1,
      components: [{ type: 2, style: 4, custom_id: `eventdelete:${eventId}`, label: 'Supprimer event', disabled }]
    }
  ];
}

function eventButtons(eventId, disabled = false, mode = 'raid') {
  if (mode === 'announce') return [];

  if (mode === 'social') {
    return withDeleteButton([{
      type: 1,
      components: [
        { type: 2, style: 1, custom_id: `role:${eventId}:present`, label: 'Présent', disabled },
        { type: 2, style: 2, custom_id: `role:${eventId}:maybe`, label: 'Maybe', disabled },
        { type: 2, style: 4, custom_id: `role:${eventId}:unavailable`, label: 'Indispo', disabled }
      ]
    }], eventId, disabled);
  }

  return withDeleteButton([
    {
      type: 1,
      components: [
        { type: 2, style: 1, custom_id: `role:${eventId}:tank`, label: 'Tank', emoji: customEmoji('Tanklogo', '🛡️'), disabled },
        { type: 2, style: 1, custom_id: `role:${eventId}:dps`, label: 'Dps', emoji: customEmoji('DPS', '⚔️'), disabled },
        { type: 2, style: 1, custom_id: `role:${eventId}:healer`, label: 'Healer', emoji: customEmoji('Healer', '💚'), disabled }
      ]
    },
    {
      type: 1,
      components: [
        { type: 2, style: 2, custom_id: `role:${eventId}:bench`, label: 'Bench', disabled },
        { type: 2, style: 2, custom_id: `role:${eventId}:unregister`, label: 'Désinscrire', disabled }
      ]
    }
  ], eventId, disabled);
}


function timezoneSelectMenu(nonce, selected = 'Europe/Paris') {
  const common = [
    'Europe/Paris', 'Asia/Tokyo', 'Europe/London', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Rome',
    'Europe/Brussels', 'Europe/Zurich', 'America/New_York', 'America/Los_Angeles', 'America/Chicago',
    'America/Toronto', 'America/Sao_Paulo', 'Australia/Sydney', 'Asia/Seoul', 'Asia/Singapore',
    'Asia/Hong_Kong', 'Asia/Dubai', 'Africa/Casablanca', 'Africa/Algiers', 'UTC'
  ];
  return [{
    type: 1,
    components: [{
      type: 3,
      custom_id: `flowtz:${nonce}`,
      placeholder: `Timezone: ${selected}`,
      min_values: 1,
      max_values: 1,
      options: common.slice(0, 25).map((tz) => ({ label: tz, value: tz, default: tz === selected }))
    }]
  }];
}

function templateButtons(nonce, selectedTimezone = 'Europe/Paris') {
  const accessible = Object.entries(templates).filter(([, tpl]) => tpl.botAccessible !== false);
  const rows = [];
  for (let i = 0; i < accessible.length; i += 5) {
    rows.push({
      type: 1,
      components: accessible.slice(i, i + 5).map(([key, tpl]) => ({
        type: 2, style: 1,
        custom_id: `template:${nonce}:${key}`,
        label: tpl.title
      }))
    });
  }
  return [
    ...timezoneSelectMenu(nonce, selectedTimezone),
    ...rows,
    { type: 1, components: [{ type: 2, style: 2, custom_id: `upload:hint:${nonce}`, label: '📤 Upload local' }] }
  ];
}

function guildEventModeButtons(nonce) {
  return [{
    type: 1,
    components: [
      { type: 2, style: 1, custom_id: `guild:${nonce}:member`, label: 'Event' },
      { type: 2, style: 3, custom_id: `guild:${nonce}:announce`, label: 'Guild Event' }
    ]
  }];
}

function classButtons(eventId, role) {
  const byRole = {
    dps: ['Bellstrike Splendor', 'Bellstrike Umbra', 'Bamboocut Wind', 'Bamboocut Burst', 'Silkbind Jade', 'Stonesplit Strength'],
    tank: ['Stonesplit Might'],
    healer: ['Silkbind Deluge']
  };
  const classes = byRole[role] || [];
  
  // Découpe en chunks de 5
  const chunks = [];
  for (let i = 0; i < classes.length; i += 5) {
    chunks.push(classes.slice(i, i + 5));
  }
  
  return chunks.map(chunk => ({
    type: 1,
    components: chunk.map((name) => ({
      type: 2,
      style: 2,
      custom_id: `class:${eventId}:${role}:${Buffer.from(name).toString('base64url')}`,
      label: name,
      emoji: customEmoji({...}[name], '✨')
    }))
  }));
}
  const classes = byRole[role] || [];
  return [{
    type: 1,
    components: classes.map((name) => ({
      type: 2,
      style: 2,
      custom_id: `class:${eventId}:${role}:${Buffer.from(name).toString('base64url')}`,
      label: name,
      emoji: customEmoji({
        'Bellstrike Splendor': 'BellstrikeSplendor',
        'Bellstrike Umbra': 'BellstrikeUmbra',
        'Bamboocut Wind': 'BamboocutWind',
        'Bamboocut Burst': 'BamboocutBurst',
        'Silkbind Jade': 'SilkbindJade',
        'Silkbind Deluge': 'SilkbindDeluge',
        'Stonesplit Might': 'StonesplitMight',
        'Stonesplit Strength': 'StonesplitStrength'
      }[name], '✨')
    }))
  }];
}

function daySelectMenu(draftId, selected = []) {
  const opts = [['lun', 'Lundi'], ['mar', 'Mardi'], ['mer', 'Mercredi'], ['jeu', 'Jeudi'], ['ven', 'Vendredi'], ['sam', 'Samedi'], ['dim', 'Dimanche']];
  return [
    {
      type: 1,
      components: [{
        type: 3,
        custom_id: `daysel:${draftId}`,
        placeholder: 'Choisis les jours (multi-sélection)',
        min_values: 1,
        max_values: 7,
        options: opts.map(([value, label]) => ({ label, value, default: selected.includes(value) }))
      }]
    },
    { type: 1, components: [{ type: 2, style: 3, custom_id: `dayconfirm:${draftId}`, label: '✅ Confirmer les jours' }] }
  ];
}

function recurrenceLabel(event) {
  if (event.recurrence === 'custom') return event.recurrenceDays?.length ? `custom (${event.recurrenceDays.join(', ')})` : 'custom';
  return event.recurrence;
}

function attendeeLabel(id, attendee = {}) {
  const displayName = String(attendee.displayName || '').trim();
  if (displayName) return `@${displayName}`;
  return `<@${id}>`;
}

function attendeeLines(event, role) {
  const entries = Object.entries(event.attendees)
    .filter(([, a]) => a.role === role)
    .map(([id, a]) => `${a.class ? `${specIcons[a.class] || '✨'} ` : ''}${attendeeLabel(id, a)}`);
  return entries.length ? entries.join(' • ') : '—';
}


function normalizeMediaUrl(mediaUrl) {
  const value = String(mediaUrl || '').trim();
  if (!value) return '';
  if (/^attachment:\/\//i.test(value)) return value;
  return /^https?:\/\//i.test(value) ? value : '';
}

function eventEmbed(event) {
  const ts = Math.floor(event.startsAt / 1000);
  const counts = { tank: 0, dps: 0, healer: 0, bench: 0, present: 0, maybe: 0, unavailable: 0 };
  Object.values(event.attendees).forEach((a) => { if (counts[a.role] !== undefined) counts[a.role] += 1; });
  const current = counts.tank + counts.dps + counts.healer;
  const title = event.title.toUpperCase().split('').join(' ');

  if (event.mode === 'announce') {
    return {
      color: 0x5f9ea0,
      title,
      description: `${event.subtitle || 'Event informatif: Ping à T-10 et au démarrage @Event Ping.'}${event.archived ? '\n🔒 Event archivé.' : ''}`,
      fields: [
        { name: '🏁 Organisateur', value: event.organizerId ? `<@${event.organizerId}>` : '—', inline: false },
        { name: '📅 Date', value: `<t:${ts}:F>`, inline: true },
        { name: '🔁 Récurrence', value: recurrenceLabel(event), inline: true }
      ],
      ...(normalizeMediaUrl(event.mediaUrl) ? { image: { url: normalizeMediaUrl(event.mediaUrl) } } : {}),
      footer: { text: 'Event • rappels auto T-10 puis T0 (rôles)' }
    };
  }

  if (event.mode === 'social') {
    return {
      color: 0x5f9ea0,
      title,
      description: `${event.subtitle || 'Statuts: Présent / Maybe / Indispo'}${event.archived ? '\n🔒 Event archivé.' : ''}`,
      fields: [
        { name: '🏁 Organisateur', value: event.organizerId ? `<@${event.organizerId}>` : '—', inline: false },
        { name: '📅 Date', value: `<t:${ts}:F>`, inline: true },
        { name: '🔁 Récurrence', value: recurrenceLabel(event), inline: true },
        { name: `✅ Présent (${counts.present})`, value: attendeeLines(event, 'present'), inline: false },
        { name: `❔ Maybe (${counts.maybe})`, value: attendeeLines(event, 'maybe'), inline: false },
        { name: `⛔ Indispo (${counts.unavailable})`, value: attendeeLines(event, 'unavailable'), inline: false }
      ],
      ...(normalizeMediaUrl(event.mediaUrl) ? { image: { url: normalizeMediaUrl(event.mediaUrl) } } : {}),
      footer: { text: 'Divinité Event • pings auto à T-10 et T0' }
    };
  }

  return {
    color: event.template === 'donjon' ? 0xf1c40f : event.template === 'raid' ? 0x3498db : 0x9b59b6,
    title,
    description: `${event.subtitle || 'Inscription via les boutons.'}${event.archived ? '\n🔒 Event archivé.' : ''}`,
    fields: [
      { name: '🏁 Organisateur', value: event.organizerId ? `<@${event.organizerId}>` : '—', inline: false },
      { name: '📅 Date', value: `<t:${ts}:F>`, inline: true },
      { name: '👥 Capacité', value: `${current}/${event.capacity}`, inline: true },
      { name: `<:Tanklogo:${emojiIds.Tanklogo}> Tank (${counts.tank})`, value: attendeeLines(event, 'tank'), inline: false },
      { name: `<:DPS:${emojiIds.DPS}> Dps (${counts.dps})`, value: attendeeLines(event, 'dps'), inline: false },
      { name: `<:Healer:${emojiIds.Healer}> Healer (${counts.healer})`, value: attendeeLines(event, 'healer'), inline: false },
      { name: `📦 Bench (${counts.bench})`, value: attendeeLines(event, 'bench'), inline: false },
      { name: '🔁 Récurrence', value: recurrenceLabel(event), inline: true }
    ],
    ...(normalizeMediaUrl(event.mediaUrl) ? { image: { url: normalizeMediaUrl(event.mediaUrl) } } : {}),
    footer: { text: 'Event • pings auto à T-10 et T0' }
  };
}

module.exports = { eventButtons, templateButtons, timezoneSelectMenu, guildEventModeButtons, classButtons, daySelectMenu, eventEmbed };
