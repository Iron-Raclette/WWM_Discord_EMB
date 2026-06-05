const fs = require('node:fs');
const path = require('node:path');

const DB_PATH = path.join(__dirname, '..', 'data', 'events.json');

function ensureDb() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ events: [], panelMessageIds: [] }, null, 2));
  }
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}

function writeDb(db) {
  ensureDb();
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function upsertEvent(event) {
  const db = readDb();
  const idx = db.events.findIndex((e) => e.id === event.id);
  if (idx === -1) db.events.push(event);
  else db.events[idx] = event;
  writeDb(db);
}

function getEvent(eventId) {
  const db = readDb();
  return db.events.find((e) => e.id === eventId);
}

function listEvents() {
  const db = readDb();
  return db.events;
}

function markPanelMessage(messageId) {
  const db = readDb();
  if (!db.panelMessageIds.includes(messageId)) {
    db.panelMessageIds.push(messageId);
    writeDb(db);
  }
}

module.exports = {
  readDb,
  writeDb,
  upsertEvent,
  getEvent,
  listEvents,
  markPanelMessage
};
