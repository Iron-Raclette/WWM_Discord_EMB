const TEMPLATES = {
  donjon: {
    key: 'swordtrial',
    name: 'Sword Trial',
    capacity: 5,
    color: 0xf1c40f
  },
  raid: {
    key: 'heroesrealm',
    name: 'Heroes Realm',
    capacity: 10,
    color: 0x3498db
  },
  gvg: {
    key: 'gvg',
    name: 'GvG',
    capacity: 50,
    color: 0x9b59b6
  }
};

const ROLE_CLASSES = {
  dps: ['Bellstrike Splendor', 'Bellstrike Umbra', 'Bamboocut Wind', 'Bamboocut Burst', 'Silkbind Jade', 'Stonesplit Strength'],
  tank: ['Stonesplit Might'],
  healer: ['Silkbind Deluge']
};

const SIGNUP_ROLES = ['tank', 'dps', 'healer', 'bench', 'late', 'tentative', 'absence'];

const RECURRENCE = {
  none: 0,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000
};

module.exports = {
  TEMPLATES,
  ROLE_CLASSES,
  SIGNUP_ROLES,
  RECURRENCE
};
