import React, {useEffect, useMemo, useState} from 'react';
import Layout from '@theme/Layout';

const MASTER_PASSWORD = 'IronRidersRaclette@WWM';
const DEFAULT_SECRET = 'JESAISPAS';

const MENU = [
  {id: 'create', label: 'Create Event'},
  {id: 'current', label: 'Current Events'},
  {id: 'logs', label: 'Bot Logs'},
  {id: 'calendar', label: 'Calendar'},
  {id: 'scheduled', label: 'Scheduled Events'},
  {id: 'templates', label: 'Templates'},
  {id: 'settings', label: 'Server Settings'}
];

const DAYS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const RECURRENCE_DAYS = [{value: 'lun', label: 'Lun'}, {value: 'mar', label: 'Mar'}, {value: 'mer', label: 'Mer'}, {value: 'jeu', label: 'Jeu'}, {value: 'ven', label: 'Ven'}, {value: 'sam', label: 'Sam'}, {value: 'dim', label: 'Dim'}];
const WEEKDAY_INDEX = {dim: 0, lun: 1, mar: 2, mer: 3, jeu: 4, ven: 5, sam: 6};
const TIMEZONES = (typeof Intl !== 'undefined' && Intl.supportedValuesOf) ? Intl.supportedValuesOf('timeZone') : ['Europe/Paris', 'Asia/Tokyo', 'UTC'];
const BASE_PING_ROLES = [
  {id: '1512495672572641361', name: 'Event'},  //ID A CHANGER ICI - ROLES
  {id: '1512495587315159102', name: 'PvE Lead'},
  {id: '1512495540569374831', name: 'Guild Master'},
  {id: '1512495635776012290', name: 'PvP Lead'}
];

const BUILTIN_TEMPLATES = [
  {id: 'swordtrial', title: 'Sword Trial'},
  {id: 'heroesrealm', title: 'Heroes Realm'},
  {id: 'gvg_l', title: 'GvG - LEAGUE'},
  {id: 'gvg_r', title: 'GvG - Ranked'},
  {id: 'gvg_c', title: 'GvG - Challenge'},
  {id: 'tower', title: 'Tower'},
  {id: 'guild_event', title: 'Guild Event'},
  {id: 'arena_3', title: '3v3'},
  {id: 'arena_5', title: '5v5'},
  {id: 'forest_5', title: 'Perception Forest - 5'},
  {id: 'web_custom', title: 'Web custom'}
];

const toInputDate = (ts) => {
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
};
const toInputTime = (ts) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const plusOneYear = (ts) => {
  const d = new Date(ts || Date.now());
  d.setFullYear(d.getFullYear() + 1);
  return d.getTime();
};

function emptyForm() {
  return {
    template: 'swordtrial', guildEventType: 'member', title: '', subtitle: '', mediaUrl: '', organizerId: '', channelId: '', date: '', time: '21:00', timezone: 'Europe/Paris',
    recurrence: 'none', recurrenceDays: [], recurrenceEndsAtDate: '', pingMode: 'attendees', pingRoleIds: []
  };
}

function getTimeZoneOffsetMs(timestamp, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(new Date(timestamp));
  const map = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), Number(map.hour), Number(map.minute), Number(map.second));
  return asUtc - timestamp;
}

function parseDateTimeInTimeZone({ year, month, day, hour, minute, second = 0 }, timeZone) {
  const approxUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let offset = getTimeZoneOffsetMs(approxUtc, timeZone);
  let result = approxUtc - offset;
  const correctedOffset = getTimeZoneOffsetMs(result, timeZone);
  if (correctedOffset !== offset) result = approxUtc - correctedOffset;
  return result;
}

function tzParts(ts, timezone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(new Date(ts));
  const map = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    weekday: map.weekday.toLowerCase(),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second)
  };
}

function addDaysKeepingWallClock(ts, days, timezone) {
  const base = tzParts(ts, timezone);
  const anchor = new Date(Date.UTC(base.year, base.month - 1, base.day + days, 12, 0, 0));
  const target = tzParts(anchor.getTime(), timezone);
  return parseDateTimeInTimeZone({ year: target.year, month: target.month, day: target.day, hour: base.hour, minute: base.minute, second: base.second }, timezone);
}

function recurrenceInstances(event, horizonEnd) {
  const endAt = event.recurrenceEndsAt || plusOneYear(event.createdAt || event.startsAt);
  const hardEnd = Math.min(endAt, horizonEnd);
  if (event.recurrence === 'none') return [event.startsAt].filter((t) => t <= hardEnd);

  const timezone = event.timezone || 'Europe/Paris';
  const out = [];
  if (event.recurrence === 'daily' || event.recurrence === 'weekly') {
    const step = event.recurrence === 'daily' ? 1 : 7;
    for (let t = event.startsAt; t <= hardEnd;) {
      out.push(t);
      t = addDaysKeepingWallClock(t, step, timezone);
    }
    return out;
  }

  if (event.recurrence === 'custom') {
    const wanted = new Set((event.recurrenceDays || []).map((d) => WEEKDAY_INDEX[d]).filter((x) => Number.isInteger(x)));
    if (!wanted.size) return [event.startsAt].filter((t) => t <= hardEnd);
    for (let t = event.startsAt; t <= hardEnd; t = addDaysKeepingWallClock(t, 1, timezone)) {
      if (wanted.has(new Date(t).getDay())) out.push(t);
    }
    return out;
  }

  return [event.startsAt].filter((t) => t <= hardEnd);
}

function roleChecks(value, onChange, options) {
  const current = Array.isArray(value) ? value : [];
  return <div className="rh-check-grid"><label><input type="checkbox" checked={current.length === 0} onChange={() => onChange([])} />Aucun</label>{options.map((r) => <label key={r.id}><input type="checkbox" checked={current.includes(r.id)} onChange={() => onChange(current.includes(r.id) ? current.filter((x) => x !== r.id) : [...current, r.id])} />{r.name}</label>)}</div>;
}

function mergeTemplates(customTemplates) {
  const map = new Map(BUILTIN_TEMPLATES.map((t) => [t.id, t]));
  (customTemplates || []).forEach((t) => {
    if (!t?.id) return;
    map.set(t.id, {id: t.id, title: t.title || t.id});
  });
  return [...map.values()];
}

function formatLogAction(entry) {
  const role = entry?.role ? ` (${entry.role})` : '';
  const fromRole = entry?.fromRole ? ` depuis ${entry.fromRole}` : '';
  const className = entry?.className ? ` • ${entry.className}` : '';
  const by = entry?.userName || entry?.userId || 'Unknown';
  const action = {
    register: 'inscription',
    'register-pending-spec': 'inscription (spé à choisir)',
    unregister: 'désinscription',
    bench: 'passage bench',
    'select-class': 'choix de spécialisation',
    'retro-current-state': 'état actuel importé (rétroactif, pas un log historique)'
  }[entry?.action] || String(entry?.action || 'action');
  return `${by} • ${action}${role}${fromRole}${className}`;
}

function eventLogsForDashboard(event) {
  const now = Date.now();
  const rawLogs = Array.isArray(event?.activityLogs) ? event.activityLogs : [];
  const seenUsers = new Set(rawLogs.map((x) => x?.userId).filter(Boolean));
  const retro = (event?.attendeesResolved || []).filter((a) => a?.id && !seenUsers.has(a.id)).map((a) => ({
    id: `retro-${event.id}-${a.id}`,
    ts: null,
    action: 'retro-current-state',
    userId: a.id,
    userName: a.name || a.id,
    role: a.role || '',
    className: a.className || '',
    source: 'dashboard-retro'
  }));
  return [...rawLogs.sort((a, b) => (b.ts || 0) - (a.ts || 0)), ...retro];
}

export default function DashboardPage() {
  const [authorized, setAuthorized] = useState(false);
  const [active, setActive] = useState('menu');
  const [msg, setMsg] = useState('');
  const [events, setEvents] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [phrases, setPhrases] = useState([]);
  const [pendingPhrases, setPendingPhrases] = useState([]);
  const [settings, setSettings] = useState({guildId: '', channelId: '', timezone: 'Europe/Paris'});
  const [form, setForm] = useState(emptyForm());
  const [editForms, setEditForms] = useState({});
  const [selectedCalendarEvent, setSelectedCalendarEvent] = useState(null);
  const [calendarMonth, setCalendarMonth] = useState(() => { const d = new Date(); return {year: d.getFullYear(), month: d.getMonth()}; });
  const [newTemplate, setNewTemplate] = useState({id: '', title: '', mode: 'raid', capacity: ''});
  const [channelOptions, setChannelOptions] = useState([]);
  const [botAvatarDataUrl, setBotAvatarDataUrl] = useState('');
  const [botAvatarPreview, setBotAvatarPreview] = useState('');

  const api = async (path, init = {}) => {
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch(`${path}${sep}secret=${encodeURIComponent(DEFAULT_SECRET)}`, {
      ...init,
      headers: {'Content-Type': 'application/json', ...(init.headers || {})}
    });
    const raw = await res.text();
    const data = raw ? JSON.parse(raw) : {};
    if (!res.ok || data.ok === false) throw new Error(data.error || 'API error');
    return data;
  };

  const loadAll = async () => {
    const config = await api('/api/dashboard-config');
    const nextSettings = config.settings || {};
    setSettings(nextSettings);
    setTemplates((config.templates || []).map((t) => ({ id: t.id || t.key || '', title: t.title || t.name || 'Template', mode: t.mode || 'heroesrealm', capacity: t.capacity ?? '' })).filter((t) => t.id));
    setPhrases(config.phrases || []);
    setPendingPhrases(config.phrasesPending || []);

    const guild = nextSettings.guildId || settings.guildId || '1512143388940566588'; //ID A CHANGER ICI - CHANNEL
    const [current, channelsRes] = await Promise.all([
      api(`/api/events?guild_id=${guild}&only=current`),
      api(`/api/guild-channels?guild_id=${guild}`)
    ]);
    setEvents(current.events || []);
    setChannelOptions(channelsRes.channels || []);
    setForm((prev) => ({...prev, timezone: nextSettings.timezone || prev.timezone, channelId: prev.channelId || nextSettings.channelId || ''}));
  };

  useEffect(() => {
    const ok = window.sessionStorage.getItem('dashboard_auth') === 'ok';
    setAuthorized(ok);
    if (ok) loadAll().catch((e) => setMsg(`Erreur chargement: ${e.message}`));
  }, []);

  const activeEvents = useMemo(() => events.filter((e) => !e.archived).sort((a, b) => a.startsAt - b.startsAt), [events]);
  const recurringEvents = useMemo(() => activeEvents.filter((e) => ['weekly', 'custom', 'daily'].includes(e.recurrence)), [activeEvents]);
  const botLogEvents = useMemo(() => activeEvents
    .filter((e) => e.startsAt >= (Date.now() - 12 * 60 * 60 * 1000) || (e.attendees && Object.keys(e.attendees).length > 0))
    .sort((a, b) => a.startsAt - b.startsAt), [activeEvents]);
  const pingRoleOptions = useMemo(() => {
    const settingsRole = settings.eventPingRoleId ? [{id: settings.eventPingRoleId, name: 'Event'}] : [];
    const seen = new Set();
    return [...settingsRole, ...BASE_PING_ROLES].filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });
  }, [settings.eventPingRoleId]);
  const allTemplates = useMemo(() => mergeTemplates(templates), [templates]);

  useEffect(() => {
    setEditForms((prev) => {
      const next = {...prev};
      activeEvents.forEach((e) => {
        if (!next[e.id]) {
          next[e.id] = {
            template: e.template || 'heroesrealm', guildEventType: e.mode === 'announce' ? 'announce' : 'member',
            title: e.title || '', subtitle: e.subtitle || '', mediaUrl: e.mediaUrl || '', channelId: e.channelId || '', date: toInputDate(e.startsAt), time: toInputTime(e.startsAt),
            timezone: e.timezone || settings.timezone || 'Europe/Paris', recurrence: e.recurrence || 'none',
            recurrenceDays: e.recurrenceDays || [],
            recurrenceEndsAtDate: e.recurrenceEndsAt ? toInputDate(e.recurrenceEndsAt) : toInputDate(plusOneYear(e.createdAt || e.startsAt)),
            pingMode: e.pingMode || 'attendees', pingRoleIds: e.pingRoleIds || []
          };
        }
      });
      return next;
    });
  }, [activeEvents, settings.timezone]);



  const onBotAvatarFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      setBotAvatarDataUrl(dataUrl);
      setBotAvatarPreview(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const uploadBotAvatar = async () => {
    if (!botAvatarDataUrl) throw new Error('Sélectionne une image avant upload.');
    await api('/api/bot-avatar', {
      method: 'PATCH',
      body: JSON.stringify({ avatarDataUrl: botAvatarDataUrl })
    });
    setMsg('✅ Avatar bot mis à jour.');
  };
  const auth = () => {
    const pass = window.prompt('Mot de passe dashboard');
    if (pass === MASTER_PASSWORD) {
      window.sessionStorage.setItem('dashboard_auth', 'ok');
      setAuthorized(true);
      loadAll().catch((e) => setMsg(`Erreur chargement: ${e.message}`));
    }
  };

  const createEvent = async () => {
    try {
      const mode = form.template === 'guild_event' ? (form.guildEventType === 'announce' ? 'announce' : 'social') : (form.template === 'web_custom' ? 'announce' : undefined);
      const pingMode = (form.template === 'guild_event' && form.guildEventType === 'announce') ? 'roles' : form.pingMode;
      await api('/api/events', {
        method: 'POST',
        body: JSON.stringify({
          guildId: settings.guildId,
          channelId: form.channelId || settings.channelId,
          template: form.template,
          title: form.title || undefined,
          subtitle: form.subtitle || undefined,
          mediaUrl: form.mediaUrl || undefined,
          organizerId: form.organizerId || undefined,
          date: form.recurrence === 'custom' ? '' : form.date,
          time: form.time,
          timezone: form.timezone,
          recurrence: form.recurrence,
          recurrenceDays: form.recurrence === 'custom' ? form.recurrenceDays : [],
          recurrenceEndsAt: form.recurrence === 'none' ? null : (form.recurrenceEndsAtDate || toInputDate(plusOneYear(Date.now()))),
          pingMode,
          pingRoleIds: form.template === 'guild_event' && form.guildEventType === 'announce' ? (form.pingRoleIds.length ? form.pingRoleIds : ['1512495672572641361']) : form.pingRoleIds, //ID A CHANGER ICI - ROLE
          mode,
          mediaFileData: form.mediaFileData,
          mediaFileName: form.mediaFileName,
          mediaFileMime: form.mediaFileMime
        })
      });
      setMsg('✅ Event créé.');
      await loadAll();
    } catch (e) {
      setMsg(`Erreur création: ${e.message}`);
    }
  };

  const updateEvent = async (eventId, patch) => {
    try {
      await api('/api/events', {method: 'PATCH', body: JSON.stringify({id: eventId, ...patch})});
      setMsg(`✅ Event ${eventId} mis à jour.`);
      await loadAll();
    } catch (e) {
      setMsg(`Erreur update: ${e.message}`);
    }
  };

  const deleteEvent = async (eventId) => {
    try {
      await api(`/api/events?id=${encodeURIComponent(eventId)}`, {method: 'DELETE'});
      setMsg(`🗑️ Event ${eventId} supprimé.`);
      setSelectedCalendarEvent(null);
      await loadAll();
    } catch (e) {
      setMsg(`Erreur suppression: ${e.message}`);
    }
  };

  const compactPhrases = (list) => (list || []).map((x) => String(x || '').trim()).filter(Boolean);

  const saveTemplatesAndPhrases = async () => {
    await api('/api/dashboard-config', {method: 'PATCH', body: JSON.stringify({templates, phrases: compactPhrases(phrases)})});
    await loadAll();
    setMsg('✅ Templates et phrases sauvegardés.');
  };

  const setPhraseAt = (index, value) => {
    setPhrases((prev) => {
      const next = [...prev];
      while (next.length <= index) next.push('');
      next[index] = value;
      return next;
    });
  };

  const addPhraseField = () => setPhrases((prev) => [...prev, '']);
  const removePhraseAt = (index) => setPhrases((prev) => prev.filter((_, i) => i !== index));


  const approvePendingPhrase = async (id) => {
    await api('/api/dashboard-config', { method: 'PATCH', body: JSON.stringify({ approvePhraseId: id }) });
    await loadAll();
    setMsg('✅ Suggestion approuvée.');
  };

  const rejectPendingPhrase = async (id) => {
    await api('/api/dashboard-config', { method: 'PATCH', body: JSON.stringify({ rejectPhraseId: id }) });
    await loadAll();
    setMsg('🗑️ Suggestion refusée.');
  };
  const upsertTemplate = () => {
    const id = String(newTemplate.id || '').trim();
    const title = String(newTemplate.title || '').trim();
    if (!id || !title) return setMsg('Template: id et title obligatoires.');
    const entry = {id, title, mode: newTemplate.mode || 'raid', capacity: newTemplate.capacity === '' ? null : Number(newTemplate.capacity)};
    setTemplates((prev) => [...prev.filter((t) => t.id !== id), entry].sort((a, b) => a.id.localeCompare(b.id)));
    setNewTemplate({id: '', title: '', mode: 'raid', capacity: ''});
  };

  const calendarCells = useMemo(() => {
    const y = calendarMonth.year;
    const m = calendarMonth.month;
    const monthStart = new Date(y, m, 1).getTime();
    const monthEnd = new Date(y, m + 1, 1).getTime() - 1;
    const first = new Date(y, m, 1);
    const startOffset = first.getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const byDay = new Map();
    const horizonEnd = plusOneYear(Date.now());

    activeEvents.forEach((event) => {
      recurrenceInstances(event, horizonEnd).forEach((ts) => {
        if (ts < monthStart || ts > monthEnd) return;
        const day = new Date(ts).getDate();
        const list = byDay.get(day) || [];
        list.push({id: `${event.id}-${ts}`, eventId: event.id, title: event.title, time: toInputTime(ts), recurrence: event.recurrence, startsAt: ts});
        byDay.set(day, list);
      });
    });

    const cells = [];
    for (let i = 0; i < startOffset; i += 1) cells.push({day: null, events: []});
    for (let d = 1; d <= daysInMonth; d += 1) cells.push({day: d, events: byDay.get(d) || []});
    while (cells.length % 7 !== 0) cells.push({day: null, events: []});
    return cells;
  }, [activeEvents, calendarMonth]);



  const calendarLabel = useMemo(() => new Date(calendarMonth.year, calendarMonth.month, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }), [calendarMonth]);
  const goCalendarMonth = (delta) => {
    setSelectedCalendarEvent(null);
    setCalendarMonth((prev) => {
      const d = new Date(prev.year, prev.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };

  if (!authorized) return <Layout title="Dashboard"><main className="rh-dark-only"><section className="rh-form-shell"><header className="rh-like-header">Dashboard protégé</header><button className="rh-green" onClick={auth}>Déverrouiller</button><p>{msg}</p></section></main></Layout>;

  return <Layout title="Dashboard" description="Divinité Dashboard"><main className="rh-dark-only">
    <section className="rh-like-shell"><header className="rh-like-header">Dashboard</header><div className="rh-actions-row">{MENU.map((m) => <button key={m.id} className="rh-mini" onClick={() => setActive(m.id)}>{m.label}</button>)}<button className="rh-mini" onClick={() => loadAll().catch((e) => setMsg(`Erreur chargement: ${e.message}`))}>Refresh</button></div><p>{msg}</p></section>

    {active === 'create' && <section className="rh-form-shell rh-page-panel"><header className="rh-like-header">Create Event</header>
      <label>Template</label><select value={form.template} onChange={(e) => setForm({...form, template: e.target.value})}>{allTemplates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select>
      {form.template === 'guild_event' && <><label>Type Guild Event</label><select value={form.guildEventType} onChange={(e) => setForm({...form, guildEventType: e.target.value})}><option value="member">Event</option><option value="announce">Guild Event</option></select></>}
      <label>Titre</label><input value={form.title} onChange={(e) => setForm({...form, title: e.target.value})} />
      <label>Sous-titre</label><input value={form.subtitle} onChange={(e) => setForm({...form, subtitle: e.target.value})} />
      <label>Image / GIF URL (optionnel)</label><input value={form.mediaUrl} onChange={(e) => setForm({...form, mediaUrl: e.target.value})} placeholder="https://..." />
      <label>ou Fichier local (optionnel)</label><input type="file" accept="image/*" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; const data = await file.arrayBuffer(); const base64 = btoa(String.fromCharCode(...new Uint8Array(data))); setForm((prev) => ({ ...prev, mediaFileData: base64, mediaFileName: file.name, mediaFileMime: file.type || 'application/octet-stream' })); }} />
      <label>Date (DD-MM-YYYY ou today)</label><input value={form.date} onChange={(e) => setForm({...form, date: e.target.value})} disabled={form.recurrence === 'custom'} />
      <label>Heure</label><input value={form.time} onChange={(e) => setForm({...form, time: e.target.value})} />
      <label>Timezone</label><input list="timezone-list" value={form.timezone} onChange={(e) => setForm({...form, timezone: e.target.value})} /><datalist id="timezone-list">{TIMEZONES.map((tz) => <option key={tz} value={tz} />)}</datalist>
      <label>Récurrence</label><select value={form.recurrence} onChange={(e) => setForm({...form, recurrence: e.target.value})}><option value="none">none</option><option value="daily">daily</option><option value="weekly">weekly</option><option value="custom">custom</option></select>
      {form.recurrence === 'custom' && <div className="rh-days">{RECURRENCE_DAYS.map((d) => <button type="button" key={d.value} className={form.recurrenceDays.includes(d.value) ? 'is-on' : ''} onClick={() => setForm((prev) => ({...prev, recurrenceDays: prev.recurrenceDays.includes(d.value) ? prev.recurrenceDays.filter((x) => x !== d.value) : [...prev.recurrenceDays, d.value]}))}>{d.label}</button>)}</div>}
      {form.recurrence !== 'none' && <><label>Date fin récurrence</label><input value={form.recurrenceEndsAtDate} onChange={(e) => setForm({...form, recurrenceEndsAtDate: e.target.value})} placeholder={toInputDate(plusOneYear(Date.now()))} /></>}
      <label>Mode ping</label><select value={form.pingMode} onChange={(e) => setForm({...form, pingMode: e.target.value})}><option value="attendees">attendees</option><option value="roles">roles</option></select>
      <label>Rôles à ping</label>{roleChecks(form.pingRoleIds, (v) => setForm({...form, pingRoleIds: v}), pingRoleOptions)}
      <button className="rh-green" onClick={createEvent}>Créer</button>
    </section>}

    {active === 'current' && <section className="rh-form-shell rh-page-panel"><header className="rh-like-header">Current Events</header>
      {activeEvents.map((e) => {
        const f = editForms[e.id] || emptyForm();
        return <article key={e.id} className="rh-event-card"><h3>{e.title}</h3><p>ID: {e.id}</p>
          <div className="rh-edit-grid">
            <select value={f.template || e.template} onChange={(ev) => setEditForms((prev) => ({...prev, [e.id]: {...f, template: ev.target.value}}))}>{allTemplates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select>
            {(f.template || e.template) === 'guild_event' && <select value={f.guildEventType || (e.mode === 'announce' ? 'announce' : 'member')} onChange={(ev) => setEditForms((prev) => ({...prev, [e.id]: {...f, guildEventType: ev.target.value}}))}><option value="member">Event</option><option value="announce">Guild Event</option></select>}
            <input value={f.title || ''} onChange={(ev) => setEditForms((prev) => ({...prev, [e.id]: {...f, title: ev.target.value}}))} placeholder="Titre" />
            <input value={f.subtitle || ''} onChange={(ev) => setEditForms((prev) => ({...prev, [e.id]: {...f, subtitle: ev.target.value}}))} placeholder="Sous-titre" />
            <input value={f.mediaUrl || e.mediaUrl || ''} onChange={(ev) => setEditForms((prev) => ({...prev, [e.id]: {...f, mediaUrl: ev.target.value}}))} placeholder="Image/GIF URL" />
            <select value={f.channelId || e.channelId || settings.channelId || ''} onChange={(ev) => setEditForms((prev) => ({...prev, [e.id]: {...f, channelId: ev.target.value}}))}><option value="">Salon par défaut</option>{channelOptions.map((ch) => <option key={ch.id} value={ch.id}>#{ch.name}</option>)}</select>
            <input type="file" accept="image/*" onChange={async (ev) => { const file = ev.target.files?.[0]; if (!file) return; const data = await file.arrayBuffer(); const base64 = btoa(String.fromCharCode(...new Uint8Array(data))); setEditForms((prev) => ({...prev, [e.id]: {...f, mediaFileData: base64, mediaFileName: file.name, mediaFileMime: file.type || 'application/octet-stream'}})); }} />
            <input value={f.date || toInputDate(e.startsAt)} onChange={(ev) => setEditForms((prev) => ({...prev, [e.id]: {...f, date: ev.target.value}}))} disabled={(f.recurrence || e.recurrence) === 'custom'} />
            <input value={f.time || toInputTime(e.startsAt)} onChange={(ev) => setEditForms((prev) => ({...prev, [e.id]: {...f, time: ev.target.value}}))} />
            <input list="timezone-list" value={f.timezone || e.timezone || settings.timezone || 'Europe/Paris'} onChange={(ev) => setEditForms((prev) => ({...prev, [e.id]: {...f, timezone: ev.target.value}}))} />
            <select value={f.recurrence || e.recurrence} onChange={(ev) => setEditForms((prev) => ({...prev, [e.id]: {...f, recurrence: ev.target.value}}))}><option value="none">none</option><option value="daily">daily</option><option value="weekly">weekly</option><option value="custom">custom</option></select>
          </div>
          {(f.recurrence || e.recurrence) === 'custom' && <div className="rh-days">{RECURRENCE_DAYS.map((d) => <button type="button" key={d.value} className={((f.recurrenceDays || e.recurrenceDays || []).includes(d.value)) ? 'is-on' : ''} onClick={() => setEditForms((prev) => { const cur = f.recurrenceDays || e.recurrenceDays || []; return {...prev, [e.id]: {...f, recurrenceDays: cur.includes(d.value) ? cur.filter((x) => x !== d.value) : [...cur, d.value]}}; })}>{d.label}</button>)}</div>}
          <label>Mode ping</label><select value={f.pingMode || e.pingMode || 'attendees'} onChange={(ev) => setEditForms((prev) => ({...prev, [e.id]: {...f, pingMode: ev.target.value}}))}><option value="attendees">attendees</option><option value="roles">roles</option></select>
          <label>Rôles à ping</label>{roleChecks(f.pingRoleIds || e.pingRoleIds || [], (v) => setEditForms((prev) => ({...prev, [e.id]: {...f, pingRoleIds: v}})), pingRoleOptions)}
          <div className="rh-actions-row"><button className="rh-green" onClick={() => {
            const finalTemplate = f.template || e.template;
            const guildType = f.guildEventType || (e.mode === 'announce' ? 'announce' : 'member');
            updateEvent(e.id, {
              template: finalTemplate,
              title: f.title || e.title,
              subtitle: f.subtitle || e.subtitle,
              mediaUrl: f.mediaUrl || e.mediaUrl || '',
              channelId: f.channelId || e.channelId || settings.channelId,
              mediaFileData: f.mediaFileData,
              mediaFileName: f.mediaFileName,
              mediaFileMime: f.mediaFileMime,
              date: f.date || toInputDate(e.startsAt),
              time: f.time || toInputTime(e.startsAt),
              timezone: f.timezone || e.timezone,
              recurrence: f.recurrence || e.recurrence,
              recurrenceDays: (f.recurrence || e.recurrence) === 'custom' ? (f.recurrenceDays || e.recurrenceDays || []) : [],
              recurrenceEndsAt: f.recurrenceEndsAtDate || (e.recurrenceEndsAt ? toInputDate(e.recurrenceEndsAt) : toInputDate(plusOneYear(e.createdAt || e.startsAt))),
              pingMode: (finalTemplate === 'guild_event' && guildType === 'announce') ? 'roles' : (f.pingMode || e.pingMode || 'attendees'),
              pingRoleIds: f.pingRoleIds || e.pingRoleIds || [],
              mode: finalTemplate === 'guild_event' ? (guildType === 'announce' ? 'announce' : 'social') : e.mode
            });
          }}>Sauvegarder</button><button className="rh-red" onClick={() => deleteEvent(e.id)}>Supprimer</button></div>
        </article>;
      })}
      {!activeEvents.length && <p>Aucun event actif.</p>}
    </section>}

    {active === 'calendar' && <section className="rh-form-shell rh-page-panel rh-calendar-panel">
      <header className="rh-like-header">Calendar</header>
      <div className="rh-calendar-toolbar">
        <button className="rh-mini" onClick={() => goCalendarMonth(-1)}>← Mois précédent</button>
        <strong className="rh-calendar-month-title">{calendarLabel}</strong>
        <button className="rh-mini" onClick={() => goCalendarMonth(1)}>Mois suivant →</button>
      </div>

      <div className="rh-calendar-grid">
        {DAYS.map((d) => <div key={d} className="rh-calendar-head">{d}</div>)}
        {calendarCells.map((c, i) => (
          <article className={`rh-calendar-cell ${!c.day ? 'is-empty' : ''}`} key={i}>
            {c.day ? <div className="rh-calendar-day">{c.day}</div> : <div className="rh-calendar-day rh-calendar-day-empty">&nbsp;</div>}
            <div className="rh-calendar-events">
              {c.events.slice(0, 4).map((e) => (
                <button
                  key={e.id}
                  type="button"
                  className="rh-calendar-chip"
                  onClick={() => setSelectedCalendarEvent({eventId: e.eventId, startsAt: e.startsAt})}
                >
                  {e.title} ({e.time})
                </button>
              ))}
              {c.events.length > 4 && <span className="rh-calendar-more">+{c.events.length - 4} autre(s)</span>}
            </div>
          </article>
        ))}
      </div>

      {selectedCalendarEvent && (() => {
        const event = activeEvents.find((x) => x.id === selectedCalendarEvent.eventId) || events.find((x) => x.id === selectedCalendarEvent.eventId);
        if (!event) return null;
        return <article className="rh-event-card"><h3>Détail calendrier</h3><p><b>{event.title}</b> — {new Date(selectedCalendarEvent.startsAt).toLocaleString()}</p><p>Template: {event.template} • Récurrence: {event.recurrence}</p><p>ID: {event.id}</p><div className="rh-actions-row"><button className="rh-red" onClick={() => deleteEvent(event.id)}>Supprimer</button><button className="rh-mini" onClick={() => setSelectedCalendarEvent(null)}>Fermer</button></div></article>;
      })()}
    </section>}

    {active === 'scheduled' && <section className="rh-form-shell rh-page-panel"><header className="rh-like-header">Scheduled Events</header>
      <article className="rh-event-card rh-highlight"><h3>Créer un event depuis Scheduled</h3>
        <div className="rh-edit-grid">
          <select value={form.template} onChange={(e) => setForm({...form, template: e.target.value})}>{allTemplates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select>
          {form.template === 'guild_event' && <select value={form.guildEventType} onChange={(e) => setForm({...form, guildEventType: e.target.value})}><option value="member">Event</option><option value="announce">Guild Event</option></select>}
          <input value={form.title} onChange={(e) => setForm({...form, title: e.target.value})} placeholder="Titre" />
          <input value={form.subtitle} onChange={(e) => setForm({...form, subtitle: e.target.value})} placeholder="Sous-titre" />
          <input value={form.mediaUrl} onChange={(e) => setForm({...form, mediaUrl: e.target.value})} placeholder="Image/GIF URL" />
          <select value={form.channelId || settings.channelId || ''} onChange={(e) => setForm({...form, channelId: e.target.value})}><option value="">Salon par défaut</option>{channelOptions.map((ch) => <option key={ch.id} value={ch.id}>#{ch.name}</option>)}</select>
          <input type="file" accept="image/*" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; const data = await file.arrayBuffer(); const base64 = btoa(String.fromCharCode(...new Uint8Array(data))); setForm((prev) => ({ ...prev, mediaFileData: base64, mediaFileName: file.name, mediaFileMime: file.type || 'application/octet-stream' })); }} />
          <input value={form.date} onChange={(e) => setForm({...form, date: e.target.value})} placeholder="DD-MM-YYYY ou today" disabled={form.recurrence === 'custom'} />
          <input value={form.time} onChange={(e) => setForm({...form, time: e.target.value})} placeholder="HH:mm" />
          <input list="timezone-list" value={form.timezone} onChange={(e) => setForm({...form, timezone: e.target.value})} placeholder="Timezone" />
          <select value={form.recurrence} onChange={(e) => setForm({...form, recurrence: e.target.value})}><option value="none">none</option><option value="daily">daily</option><option value="weekly">weekly</option><option value="custom">custom</option></select>
        </div>
        {form.recurrence === 'custom' && <div className="rh-days">{RECURRENCE_DAYS.map((d) => <button type="button" key={d.value} className={form.recurrenceDays.includes(d.value) ? 'is-on' : ''} onClick={() => setForm((prev) => ({...prev, recurrenceDays: prev.recurrenceDays.includes(d.value) ? prev.recurrenceDays.filter((x) => x !== d.value) : [...prev.recurrenceDays, d.value]}))}>{d.label}</button>)}</div>}
        {form.recurrence !== 'none' && <input value={form.recurrenceEndsAtDate} onChange={(e) => setForm({...form, recurrenceEndsAtDate: e.target.value})} placeholder="Expiration DD-MM-YYYY" />}
        <label>Rôles à ping</label>{roleChecks(form.pingRoleIds, (v) => setForm({...form, pingRoleIds: v}), pingRoleOptions)}
        <div className="rh-actions-row"><button className="rh-green" onClick={createEvent}>Créer depuis Scheduled</button></div>
      </article>
      {recurringEvents.map((e) => {
        const f = editForms[e.id] || emptyForm();
        return <article key={e.id} className="rh-event-card"><h3>{e.title}</h3><p>ID: {e.id}</p>
          <div className="rh-edit-grid">
            <select value={f.template || e.template} onChange={(ev) => setEditForms((prev) => ({...prev, [e.id]: {...f, template: ev.target.value}}))}>{allTemplates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select>
            {(f.template || e.template) === 'guild_event' && <select value={f.guildEventType || (e.mode === 'announce' ? 'announce' : 'member')} onChange={(ev) => setEditForms((prev) => ({...prev, [e.id]: {...f, guildEventType: ev.target.value}}))}><option value="member">Event</option><option value="announce">Guild Event</option></select>}
            <input value={f.title || ''} onChange={(ev) => setEditForms((prev) => ({...prev, [e.id]: {...f, title: ev.target.value}}))} placeholder="Titre" />
            <input value={f.subtitle || ''} onChange={(ev) => setEditForms((prev) => ({...prev, [e.id]: {...f, subtitle: ev.target.value}}))} placeholder="Sous-titre" />
            <input value={f.mediaUrl || e.mediaUrl || ''} onChange={(ev) => setEditForms((prev) => ({...prev, [e.id]: {...f, mediaUrl: ev.target.value}}))} placeholder="Image/GIF URL" />
            <select value={f.channelId || e.channelId || settings.channelId || ''} onChange={(ev) => setEditForms((prev) => ({...prev, [e.id]: {...f, channelId: ev.target.value}}))}><option value="">Salon par défaut</option>{channelOptions.map((ch) => <option key={ch.id} value={ch.id}>#{ch.name}</option>)}</select>
            <input type="file" accept="image/*" onChange={async (ev) => { const file = ev.target.files?.[0]; if (!file) return; const data = await file.arrayBuffer(); const base64 = btoa(String.fromCharCode(...new Uint8Array(data))); setEditForms((prev) => ({...prev, [e.id]: {...f, mediaFileData: base64, mediaFileName: file.name, mediaFileMime: file.type || 'application/octet-stream'}})); }} />
            <input value={f.date || toInputDate(e.startsAt)} onChange={(ev) => setEditForms((prev) => ({...prev, [e.id]: {...f, date: ev.target.value}}))} disabled={(f.recurrence || e.recurrence) === 'custom'} />
            <input value={f.time || toInputTime(e.startsAt)} onChange={(ev) => setEditForms((prev) => ({...prev, [e.id]: {...f, time: ev.target.value}}))} />
            <input list="timezone-list" value={f.timezone || e.timezone || settings.timezone || 'Europe/Paris'} onChange={(ev) => setEditForms((prev) => ({...prev, [e.id]: {...f, timezone: ev.target.value}}))} />
            <select value={f.recurrence || e.recurrence} onChange={(ev) => setEditForms((prev) => ({...prev, [e.id]: {...f, recurrence: ev.target.value}}))}><option value="daily">daily</option><option value="weekly">weekly</option><option value="custom">custom</option><option value="none">none</option></select>
          </div>
          {(f.recurrence || e.recurrence) === 'custom' && <div className="rh-days">{RECURRENCE_DAYS.map((d) => <button type="button" key={d.value} className={((f.recurrenceDays || e.recurrenceDays || []).includes(d.value)) ? 'is-on' : ''} onClick={() => setEditForms((prev) => { const cur = f.recurrenceDays || e.recurrenceDays || []; return {...prev, [e.id]: {...f, recurrenceDays: cur.includes(d.value) ? cur.filter((x) => x !== d.value) : [...cur, d.value]}}; })}>{d.label}</button>)}</div>}
          <label>Date fin récurrence</label><input value={f.recurrenceEndsAtDate || (e.recurrenceEndsAt ? toInputDate(e.recurrenceEndsAt) : toInputDate(plusOneYear(e.createdAt || e.startsAt)))} onChange={(ev) => setEditForms((prev) => ({...prev, [e.id]: {...f, recurrenceEndsAtDate: ev.target.value}}))} placeholder="DD-MM-YYYY" />
          <label>Mode ping</label><select value={f.pingMode || e.pingMode || 'attendees'} onChange={(ev) => setEditForms((prev) => ({...prev, [e.id]: {...f, pingMode: ev.target.value}}))}><option value="attendees">attendees</option><option value="roles">roles</option></select>
          <label>Rôles à ping</label>{roleChecks(f.pingRoleIds || e.pingRoleIds || [], (v) => setEditForms((prev) => ({...prev, [e.id]: {...f, pingRoleIds: v}})), pingRoleOptions)}
          <div className="rh-actions-row"><button className="rh-green" onClick={() => {
            const finalTemplate = f.template || e.template;
            const guildType = f.guildEventType || (e.mode === 'announce' ? 'announce' : 'member');
            updateEvent(e.id, {
              template: finalTemplate,
              title: f.title || e.title,
              subtitle: f.subtitle || e.subtitle,
              mediaUrl: f.mediaUrl || e.mediaUrl || '',
              channelId: f.channelId || e.channelId || settings.channelId,
              mediaFileData: f.mediaFileData,
              mediaFileName: f.mediaFileName,
              mediaFileMime: f.mediaFileMime,
              date: f.date || toInputDate(e.startsAt),
              time: f.time || toInputTime(e.startsAt),
              timezone: f.timezone || e.timezone,
              recurrence: f.recurrence || e.recurrence,
              recurrenceDays: (f.recurrence || e.recurrence) === 'custom' ? (f.recurrenceDays || e.recurrenceDays || []) : [],
              recurrenceEndsAt: f.recurrenceEndsAtDate || (e.recurrenceEndsAt ? toInputDate(e.recurrenceEndsAt) : toInputDate(plusOneYear(e.createdAt || e.startsAt))),
              pingMode: (finalTemplate === 'guild_event' && guildType === 'announce') ? 'roles' : (f.pingMode || e.pingMode || 'attendees'),
              pingRoleIds: f.pingRoleIds || e.pingRoleIds || [],
              mode: finalTemplate === 'guild_event' ? (guildType === 'announce' ? 'announce' : 'social') : e.mode
            });
          }}>Sauvegarder</button><button className="rh-red" onClick={() => deleteEvent(e.id)}>Supprimer</button></div>
        </article>;
      })}
      {!recurringEvents.length && <p>Aucun event récurrent actif.</p>}
    </section>}

    {active === 'logs' && <section className="rh-form-shell rh-page-panel"><header className="rh-like-header">Bot Logs (events en cours et à venir)</header>
      {botLogEvents.map((e) => {
        const rows = eventLogsForDashboard(e);
        return <article key={`logs-${e.id}`} className="rh-event-card"><h3>{e.title}</h3><p>ID: {e.id} • <strong>{new Date(e.startsAt).toLocaleString('fr-FR')}</strong></p>
          {!rows.length && <p>Aucun log pour le moment.</p>}
          {!!rows.length && <ul>
            {rows.map((row) => <li key={row.id || `${e.id}-${row.ts}-${row.userId || 'unknown'}`}><strong>{row.ts ? new Date(row.ts).toLocaleString('fr-FR') : "RÉTRO (pas d'heure historique)"}</strong> — {formatLogAction(row)}</li>)}
          </ul>}
        </article>;
      })}
      {!botLogEvents.length && <p>Aucun event en cours/à venir pour afficher les logs.</p>}
    </section>}

    {active === 'templates' && <section className="rh-form-shell rh-page-panel"><header className="rh-like-header">Templates & random phrases</header>
      <article className="rh-event-card rh-event-card-stack"><h3>Templates personnalisés</h3>
        <div className="rh-edit-grid">
          <input placeholder="id (ex: boss_rush)" value={newTemplate.id} onChange={(e) => setNewTemplate({...newTemplate, id: e.target.value})} />
          <input placeholder="Titre" value={newTemplate.title} onChange={(e) => setNewTemplate({...newTemplate, title: e.target.value})} />
          <select value={newTemplate.mode} onChange={(e) => setNewTemplate({...newTemplate, mode: e.target.value})}><option value="raid">raid</option><option value="social">social</option><option value="announce">announce</option></select>
          <input placeholder="Capacité (vide = illimité)" value={newTemplate.capacity} onChange={(e) => setNewTemplate({...newTemplate, capacity: e.target.value})} />
        </div>
        <div className="rh-actions-row"><button className="rh-green" onClick={upsertTemplate}>Ajouter / Mettre à jour</button></div>
        {(templates || []).map((t) => <div key={t.id} className="rh-actions-row"><span>{t.id} — {t.title} ({t.mode}, cap: {t.capacity ?? '∞'})</span><button className="rh-red" onClick={() => setTemplates((prev) => prev.filter((x) => x.id !== t.id))}>Supprimer</button></div>)}
      </article>
      <article className="rh-event-card rh-event-card-stack"><h3>Phrases random</h3>
        <p>Configure jusqu'à 10 phrases rapidement, puis ouvre les champs supplémentaires si besoin.</p>
        {Array.from({length: Math.max(10, phrases.length)}).slice(0, 10).map((_, i) => <div key={`phrase-main-${i}`} className="rh-actions-row rh-phrase-row"><input value={phrases[i] || ''} placeholder={`Phrase ${i + 1}`} onChange={(e) => setPhraseAt(i, e.target.value)} /><button className="rh-red" type="button" onClick={() => setPhraseAt(i, '')}>Vider</button></div>)}
        {Math.max(0, phrases.length - 10) > 0 && <details className="rh-phrase-expand"><summary>Champs supplémentaires ({phrases.length - 10})</summary>{phrases.slice(10).map((value, extraIndex) => { const index = extraIndex + 10; return <div key={`phrase-extra-${index}`} className="rh-actions-row rh-phrase-row"><input value={value || ''} placeholder={`Phrase ${index + 1}`} onChange={(e) => setPhraseAt(index, e.target.value)} /><button className="rh-red" type="button" onClick={() => removePhraseAt(index)}>Supprimer</button></div>; })}</details>}
        <div className="rh-actions-row"><button className="rh-mini" type="button" onClick={addPhraseField}>+ Ajouter une phrase</button></div>
      </article>
      <article className="rh-event-card rh-event-card-stack"><h3>Suggestions LE SAVIEZ-VOUS en attente</h3>
        {!pendingPhrases.length && <p>Aucune suggestion en attente.</p>}
        {pendingPhrases.map((p) => <div key={p.id} className="rh-actions-row"><span>“{p.phrase}” — {p.userName || p.userId || 'inconnu'}</span><button className="rh-green" type="button" onClick={() => approvePendingPhrase(p.id).catch((e) => setMsg(`Erreur validation: ${e.message}`))}>Approuver</button><button className="rh-red" type="button" onClick={() => rejectPendingPhrase(p.id).catch((e) => setMsg(`Erreur validation: ${e.message}`))}>Refuser</button></div>)}
      </article>
      <button className="rh-green" onClick={saveTemplatesAndPhrases}>Sauvegarder templates + phrases</button>
    </section>}

    {active === 'settings' && <section className="rh-form-shell rh-page-panel"><header className="rh-like-header">Server Settings</header>{Object.keys(settings).map((k) => <div key={k}><label>{k}</label><input value={Array.isArray(settings[k]) ? settings[k].join(',') : String(settings[k] ?? '')} onChange={(e) => setSettings((prev) => ({...prev, [k]: Array.isArray(prev[k]) ? e.target.value.split(',').map((x) => x.trim()).filter(Boolean) : e.target.value}))} /></div>)}<button className="rh-green" onClick={() => api('/api/dashboard-config', {method: 'PATCH', body: JSON.stringify({settings})}).then(loadAll)}>Sauvegarder settings</button>
      <article className="rh-event-card">
        <h3>Photo de profil du bot</h3>
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => onBotAvatarFile(e.target.files?.[0])} />
        {botAvatarPreview && <div><p>Aperçu:</p><img src={botAvatarPreview} alt="Avatar bot preview" style={{maxWidth: 180, borderRadius: 12}} /></div>}
        <div className="rh-actions-row"><button className="rh-green" onClick={() => uploadBotAvatar().catch((e) => setMsg(`Erreur avatar: ${e.message}`))}>Uploader et mettre à jour l'avatar bot</button></div>
      </article>
    </section>}
  </main></Layout>;
}
