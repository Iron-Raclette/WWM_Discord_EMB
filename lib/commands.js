const createEventOptions = [
  {
    type: 3,
    name: 'media_url',
    description: 'URL image/GIF optionnelle à afficher dans l’event',
    required: false
  },
  {
    type: 11,
    name: 'media_file',
    description: 'Image/GIF locale optionnelle (téléphone/PC)',
    required: false
  }
];

const commands = [
  {
    name: 'create-event',
    description: 'Créer un event Divinité (Donjon/Raid/GvG)',
    options: createEventOptions
  },
  {
    name: 'createevent',
    description: 'Alias de /create-event (sans tiret)',
    options: createEventOptions
  },
  {
    name: 'setup-events',
    description: 'Poster un bouton "Créer event" dans le salon courant'
  },
  {
    name: 'my-events',
    description: 'Lister les events actifs du serveur'
  },
  {
    name: 'cancel-event',
    description: 'Archiver un event par son identifiant',
    options: [
      {
        type: 3,
        name: 'event_id',
        description: "ID de l'event (ex: abc123def4)",
        required: true
      }
    ]
  },
  {
    name: 'calendar',
    description: 'Afficher le calendrier mensuel des events du serveur'
  },
  {
    name: 'setup-calendar',
    description: 'Poster un bouton pour afficher le calendrier mensuel'
  },
  {
    name: 'setupcalendar',
    description: 'Alias de /setup-calendar (sans tiret)'
  },
  {
    name: 'dashboard',
    description: 'Afficher le lien du dashboard et d’invitation'
  },
  {
    name: 'random-phrase',
    description: 'Envoyer une phrase aléatoire configurée dans le dashboard'
  },
  {
    name: 'setup-random',
    description: 'Poster un bouton pour envoyer une phrase aléatoire'
  },
  {
    name: 'setup-proposer',
    description: 'Poster un bouton pour proposer un LE SAVIEZ-VOUS'
  },
  {
    name: 'start-random',
    description: "Démarrer l'envoi automatique d'une phrase random toutes les 14 heures (jamais entre 23h et 9h FR)"
  },
  {
    name: 'stop-random',
    description: "Arrêter l'envoi automatique des phrases random dans ce salon"
  },
  {
    name: 'purge-cache',
    description: 'Nettoyer les pings de rappel des events passés (admin)'
  }
];

module.exports = { commands };
