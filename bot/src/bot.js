require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const crypto = require('node:crypto');
const { TEMPLATES, ROLE_CLASSES, SIGNUP_ROLES, RECURRENCE } = require('./config');
const { upsertEvent, getEvent, listEvents, markPanelMessage } = require('./storage');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const ARCHIVE_CHANNEL_ID = process.env.ARCHIVE_CHANNEL_ID;
const TZ = process.env.TIMEZONE || 'Europe/Paris';

if (!TOKEN || !CLIENT_ID) {
  throw new Error('Missing DISCORD_TOKEN or CLIENT_ID in bot/.env');
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel]
});

const commands = [
  new SlashCommandBuilder()
    .setName('setup-events')
    .setDescription('Post the event creation panel in this channel'),
  new SlashCommandBuilder().setName('help-events').setDescription('Show help for this custom event bot')
].map((cmd) => cmd.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log(`Registered guild commands for ${GUILD_ID}`);
  } else {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('Registered global commands');
  }
}

function parseDateTime(dateStr, timeStr) {
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : null;
  const safeTime = /^\d{2}:\d{2}$/.test(timeStr) ? timeStr : null;
  if (!safeDate || !safeTime) return null;

  const iso = `${safeDate}T${safeTime}:00`;
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function formatDate(ts) {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: TZ
  }).format(new Date(ts));
}

function eventButtons(eventId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`role:${eventId}:tank`).setLabel('Tank').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`role:${eventId}:dps`).setLabel('Dps').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`role:${eventId}:healer`).setLabel('Healer').setStyle(ButtonStyle.Primary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`role:${eventId}:bench`).setLabel('Bench').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`role:${eventId}:late`).setLabel('Late').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`role:${eventId}:tentative`).setLabel('Tentative').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`role:${eventId}:absence`).setLabel('Absence').setStyle(ButtonStyle.Secondary)
    )
  ];
}

function buildEventEmbed(event) {
  const counts = Object.fromEntries(SIGNUP_ROLES.map((r) => [r, 0]));
  for (const attendee of Object.values(event.attendees)) {
    counts[attendee.role] = (counts[attendee.role] || 0) + 1;
  }

  const mainCount = counts.tank + counts.dps + counts.healer;

  return new EmbedBuilder()
    .setColor(TEMPLATES[event.template].color)
    .setTitle(`${event.title}`)
    .setDescription(event.archived ? '🔒 Événement archivé.' : 'Cliquez sur un rôle pour vous inscrire.')
    .addFields(
      { name: 'Date / Heure', value: formatDate(event.startAt), inline: false },
      { name: 'Capacité', value: `${mainCount}/${event.capacity}`, inline: true },
      { name: 'Bench', value: String(counts.bench), inline: true },
      { name: 'Récurrence', value: event.recurrence, inline: true }
    )
    .setFooter({ text: `Reminder: 10 min avant • ID: ${event.id}` });
}

function nextRoleForCapacity(event, role) {
  if (!['tank', 'dps', 'healer'].includes(role)) return role;
  const active = Object.values(event.attendees).filter((a) => ['tank', 'dps', 'healer'].includes(a.role)).length;
  return active >= event.capacity ? 'bench' : role;
}

function updateAttendee(event, userId, data) {
  const existing = event.attendees[userId] || {};
  event.attendees[userId] = { ...existing, ...data };
}

async function refreshEventMessage(event) {
  const channel = await client.channels.fetch(event.channelId);
  const message = await channel.messages.fetch(event.messageId);

  const rows = event.archived
    ? eventButtons(event.id).map((r) => {
        r.components.forEach((c) => c.setDisabled(true));
        return r;
      })
    : eventButtons(event.id);

  await message.edit({ embeds: [buildEventEmbed(event)], components: rows });
}

async function createEventMessage({ templateKey, channelId, startAt, recurrence }) {
  const template = TEMPLATES[templateKey];
  const event = {
    id: crypto.randomUUID().slice(0, 8),
    template: templateKey,
    title: template.name,
    capacity: template.capacity,
    startAt: startAt.getTime(),
    recurrence,
    channelId,
    messageId: null,
    attendees: {},
    reminded: false,
    archived: false,
    createdAt: Date.now()
  };

  const channel = await client.channels.fetch(channelId);
  const sent = await channel.send({
    embeds: [buildEventEmbed(event)],
    components: eventButtons(event.id)
  });

  event.messageId = sent.id;
  upsertEvent(event);
  return event;
}

function creationPanel() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('event:create').setLabel('Créer event').setStyle(ButtonStyle.Success)
    )
  ];
}

function templatePicker(eventNonce) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`template:${eventNonce}:swordtrial`).setLabel('Sword Trial').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`template:${eventNonce}:heroesrealm`).setLabel('Heroes Realm').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`template:${eventNonce}:gvg`).setLabel('GvG').setStyle(ButtonStyle.Primary)
    )
  ];
}

function classButtons(eventId, role) {
  const classes = ROLE_CLASSES[role] || [];
  const row = new ActionRowBuilder();
  classes.slice(0, 5).forEach((klass) => {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`class:${eventId}:${role}:${Buffer.from(klass).toString('base64url')}`)
        .setLabel(klass)
        .setStyle(ButtonStyle.Secondary)
    );
  });
  return classes.length ? [row] : [];
}

function addRecurrence(date, recurrence) {
  const delta = RECURRENCE[recurrence] || 0;
  return new Date(date.getTime() + delta);
}

async function schedulerTick() {
  const now = Date.now();
  const events = listEvents();

  for (const event of events) {
    if (event.archived) continue;

    const reminderAt = event.startAt - 10 * 60 * 1000;
    if (!event.reminded && now >= reminderAt && now < event.startAt + 60 * 1000) {
      try {
        const channel = await client.channels.fetch(event.channelId);
        const mentionIds = Object.entries(event.attendees)
          .filter(([, a]) => ['tank', 'dps', 'healer', 'late', 'tentative'].includes(a.role))
          .map(([uid]) => `<@${uid}>`);

        await channel.send({
          content: `⏰ Rappel: **${event.title}** commence dans 10 minutes. ${mentionIds.join(' ')}`.trim()
        });
        event.reminded = true;
        upsertEvent(event);
      } catch (e) {
        console.error('Reminder failure', e.message);
      }
    }

    const archiveAt = event.startAt + 60 * 60 * 1000;
    if (now >= archiveAt) {
      try {
        event.archived = true;
        await refreshEventMessage(event);

        if (ARCHIVE_CHANNEL_ID) {
          const archiveChannel = await client.channels.fetch(ARCHIVE_CHANNEL_ID);
          await archiveChannel.send(`🗄️ Event archivé: **${event.title}** (${formatDate(event.startAt)})`);
        }

        if (event.recurrence !== 'none') {
          const nextStart = addRecurrence(new Date(event.startAt), event.recurrence);
          await createEventMessage({
            templateKey: event.template,
            channelId: event.channelId,
            startAt: nextStart,
            recurrence: event.recurrence
          });
        }

        upsertEvent(event);
      } catch (e) {
        console.error('Archive failure', e.message);
      }
    }
  }
}

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands();
  setInterval(schedulerTick, 60 * 1000);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'setup-events') {
        const msg = await interaction.channel.send({
          content: '🎮 Création rapide d’events: cliquez sur **Créer event**.',
          components: creationPanel()
        });
        markPanelMessage(msg.id);
        await interaction.reply({ content: 'Panel créé.', ephemeral: true });
      }

      if (interaction.commandName === 'help-events') {
        await interaction.reply({
          ephemeral: true,
          content:
            'Workflow: 1) /setup-events 2) Créer event 3) Donjon/Raid/GvG 4) Date/heure.\n' +
            'Un rappel est envoyé 10 min avant. Les events peuvent être récurrents (none/daily/weekly) et s’archivent automatiquement après la fin.'
        });
      }
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId === 'event:create') {
        const nonce = crypto.randomUUID().slice(0, 8);
        await interaction.reply({
          ephemeral: true,
          content: 'Choisissez un template:',
          components: templatePicker(nonce)
        });
        return;
      }

      if (interaction.customId.startsWith('template:')) {
        const [, nonce, templateKey] = interaction.customId.split(':');
        if (!TEMPLATES[templateKey]) {
          await interaction.reply({ content: 'Template inconnu.', ephemeral: true });
          return;
        }

        const modal = new ModalBuilder().setCustomId(`create:${nonce}:${templateKey}`).setTitle(`Créer ${TEMPLATES[templateKey].name}`);
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('date')
              .setLabel('Date (YYYY-MM-DD)')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setPlaceholder('2026-02-16')
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('time')
              .setLabel('Heure (HH:mm)')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setPlaceholder('22:00')
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('recurrence')
              .setLabel('Récurrence (none|daily|weekly)')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setPlaceholder('none')
              .setValue('none')
          )
        );

        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId.startsWith('role:')) {
        const [, eventId, role] = interaction.customId.split(':');
        const event = getEvent(eventId);
        if (!event || event.archived) {
          await interaction.reply({ content: 'Event introuvable ou archivé.', ephemeral: true });
          return;
        }

        const targetRole = nextRoleForCapacity(event, role);
        updateAttendee(event, interaction.user.id, {
          role: targetRole,
          class: null,
          updatedAt: Date.now()
        });

        if (['dps', 'tank', 'healer'].includes(targetRole)) {
          await interaction.reply({
            ephemeral: true,
            content: `Sélectionnez votre spécialisation pour ${targetRole.toUpperCase()}:`,
            components: classButtons(eventId, targetRole)
          });
        } else {
          await interaction.reply({ ephemeral: true, content: `Inscription enregistrée dans ${targetRole}.` });
        }

        upsertEvent(event);
        await refreshEventMessage(event);
        return;
      }

      if (interaction.customId.startsWith('class:')) {
        const [, eventId, role, klassEncoded] = interaction.customId.split(':');
        const event = getEvent(eventId);
        if (!event) {
          await interaction.reply({ content: 'Event introuvable.', ephemeral: true });
          return;
        }

        const klass = Buffer.from(klassEncoded, 'base64url').toString('utf8');
        updateAttendee(event, interaction.user.id, {
          role,
          class: klass,
          updatedAt: Date.now()
        });

        upsertEvent(event);
        await interaction.update({ content: `✅ Spécialisation enregistrée: **${klass}**`, components: [] });
        await refreshEventMessage(event);
        return;
      }
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('create:')) {
      const [, , templateKey] = interaction.customId.split(':');
      const date = interaction.fields.getTextInputValue('date');
      const time = interaction.fields.getTextInputValue('time');
      const recurrenceRaw = interaction.fields.getTextInputValue('recurrence').toLowerCase().trim();
      const recurrence = RECURRENCE[recurrenceRaw] === undefined ? 'none' : recurrenceRaw;

      const parsed = parseDateTime(date, time);
      if (!parsed) {
        await interaction.reply({
          ephemeral: true,
          content: 'Format invalide. Utilise Date YYYY-MM-DD et Heure HH:mm.'
        });
        return;
      }

      if (parsed.getTime() <= Date.now()) {
        await interaction.reply({ ephemeral: true, content: 'La date doit être dans le futur.' });
        return;
      }

      const event = await createEventMessage({
        templateKey,
        channelId: interaction.channelId,
        startAt: parsed,
        recurrence
      });

      await interaction.reply({
        ephemeral: true,
        content: `✅ Event ${event.title} créé pour ${formatDate(event.startAt)} (${recurrence}).`
      });
      return;
    }
  } catch (e) {
    console.error(e);
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: 'Une erreur est survenue.', ephemeral: true }).catch(() => null);
    } else {
      await interaction.reply({ content: 'Une erreur est survenue.', ephemeral: true }).catch(() => null);
    }
  }
});

client.login(TOKEN);
