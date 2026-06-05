# Divinité Bot — version Vercel (refonte)

Ce projet utilise maintenant **Discord Interactions + Vercel Functions** (pas de process permanent).

## Ce que ça fait

- Dashboard dark-only (sans lien Invite Bot)
- `/create-event` ou `/createevent` → choix **Donjon / Raid / GvG / Guild Event**
- 4e template Guild Event: mode **Event** (Présent/Maybe/Indispo) ou mode **Guild Event** (récurrent + ping rôles)
- `/setup-events` → poste un bouton **Créer event** dans le salon
- `/my-events` → liste les events actifs avec ID
- `/cancel-event event_id:<id>` → archive un event
- en mode `custom`, sélection multi-jours (Lun→Dim) avant validation
- saisie date/heure/récurrence (`none|daily|weekly|custom`)
- date acceptée en `DD-MM-YYYY` ou `today`
- boutons d’inscription: Tank / Dps / Healer + Bench / Late / Tentative / Absence
- sous-boutons de spécialisation pour Dps/Tank/Healer
- reminder auto 10 minutes avant + ping à l'heure exacte
- archivage auto + création de la prochaine occurrence

## Setup ultra simple (Vercel)

1. Push ce repo sur GitHub.
2. Crée un projet sur Vercel depuis ce repo.
3. Ajoute une base **Vercel KV** au projet.
4. Dans Vercel > Settings > Environment Variables, ajoute:
   - `DISCORD_TOKEN`
   - `CLIENT_ID` (ton app id)
   - `DISCORD_PUBLIC_KEY`
   - `CRON_SECRET` (random secret)
   - `COMMANDS_SECRET` (optionnel, sinon fallback sur `CRON_SECRET`)
   - `DASHBOARD_SECRET` (optionnel, sinon fallback sur `COMMANDS_SECRET`)
   - `KV_REST_API_URL`
   - `KV_REST_API_TOKEN`
   - `DISCORD_SKIP_SIGNATURE_CHECK=false`
   - `MEMBRE_ROLE_ID` et `APPRENTI_ROLE_ID` (optionnel, pour ping rôles auto)
5. Déploie.

## Discord Developer Portal

### 1) Interactions endpoint

Dans ton app Discord > **General Information** > **Interactions Endpoint URL** :

`https://<ton-projet>.vercel.app/api/interactions`

### 2) Slash commands

En local (ou CI), depuis `bot/`:

```bash
npm run register:commands
```

Variables nécessaires en local: `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID` (optionnel).

#### Alternative sans terminal local (recommandé si rien n'apparaît dans `/`)

Tu peux forcer l'enregistrement directement depuis Vercel via un endpoint sécurisé :

`https://<ton-projet>.vercel.app/api/register-commands?secret=<COMMANDS_SECRET>&guild_id=<GUILD_ID>`

- `guild_id` est recommandé pour que les commandes apparaissent quasi instantanément.
- Sans `guild_id`, Discord enregistre en global (propagation parfois lente).
- Tu peux aussi envoyer un header `Authorization: Bearer <COMMANDS_SECRET>` à la place du query param.


## Mettre à jour la photo de profil du bot

Le dashboard web permet maintenant d'uploader l'avatar du bot directement depuis **Server Settings**.
Le repo inclut aussi un script CLI pour pousser un avatar vers Discord via l'API `PATCH /users/@me`.

Par défaut, il utilise `static/img/logo.png` (logo Divinité du repo):

```bash
cd bot
export DISCORD_TOKEN="<BOT_TOKEN>"
npm run bot:avatar
```

Pour utiliser une autre image:

```bash
cd bot
export DISCORD_TOKEN="<BOT_TOKEN>"
node scripts/update-avatar.js /chemin/vers/avatar.png
```

Formats supportés: `png`, `jpg`, `jpeg`, `webp`, `gif`.

## Cron reminders/archivage

### Limite Vercel Hobby

En plan **Hobby**, Vercel refuse les crons plus fréquents qu'une fois par jour.
Par défaut, ce repo **n'active plus de cron Vercel** pour éviter les échecs de déploiement: on passe par un cron externe.

### Solution gratuite recommandée

Utilise un **cron externe** (ex: cron-job.org) pour appeler:

`https://<ton-projet>.vercel.app/api/cron/events`

avec l'header:

`Authorization: Bearer <CRON_SECRET>`

Fréquence conseillée: **1 minute** (ou 5 min si ton provider impose une limite).

Le cron tolère maintenant la dérive de planification:
- rappel "T-10" accepté jusqu'à **15 min après** l'heure de départ,
- ping "T0" accepté jusqu'à **30 min après** l'heure de départ.

Par défaut, le handler cron **n'attend plus** la seconde exacte (pour éviter les timeouts des providers avec limite 15s).
Si tu veux réactiver l'attente fine, définis:
- `CRON_EXACT_TIMING=true`
- `CRON_MAX_EXACT_WAIT_MS` (ex: `1500`)

Résultat: quand le provider appelle à `hh:mm:50`, le bot peut patienter et poster à `hh:mm:00`.
Limite: si le provider appelle en retard (ex: après `hh:mm:00`), la seconde exacte n'est plus rattrapable sans worker permanent.

Cela garde reminders 10 min, archivage et récurrence sans passer en plan payant.

Optimisation Upstash incluse: la lecture des events utilise maintenant `MGET` par batch (au lieu d'une série de `GET` unitaires), ce qui réduit fortement le volume de commandes Redis consommées par les runs cron.

Sécurité anti-timeout (important pour cron-job.org / providers avec timeout ~15s):
- `CRON_MAX_HANDLER_MS` (défaut `9000`) limite le temps de traitement par run,
- `CRON_MAX_RANDOM_SENDS_PER_RUN` (défaut `2`) limite les envois automatiques random par exécution,
- la réponse JSON inclut `timedOut` et `durationMs` pour diagnostiquer les runs.

### `CRON_SECRET`: où le récupérer ?

Tu ne le récupères pas depuis Discord ni depuis Vercel: c'est **toi qui le crées**.

1. Génère une valeur aléatoire (longue et difficile à deviner), par exemple:
   ```bash
   openssl rand -base64 32
   ```
2. Mets cette valeur dans Vercel:
   - Key: `CRON_SECRET`
   - Value: `<la_valeur_générée>`
3. Réutilise **exactement la même valeur** dans ton cron externe:
   - Header `Authorization: Bearer <CRON_SECRET>`

Important: la "cron job api key" d'un provider tiers n'est pas automatiquement ton `CRON_SECRET`.
Tu peux utiliser la même valeur si tu veux, mais évite de publier cette clé et fais une rotation en cas de fuite.


### Pourquoi `/api/cron/events` répond `Unauthorized` ?

C'est normal si tu ouvres l'URL directement dans le navigateur.
Ce endpoint est protégé.

Tu dois appeler soit:

- avec header `Authorization: Bearer <CRON_SECRET>`
- ou avec query string `?secret=<CRON_SECRET>`

Exemple test rapide:

`https://<ton-projet>.vercel.app/api/cron/events?secret=<CRON_SECRET>`

Optionnel: si tu utilises le cron natif Vercel, ajoute `ALLOW_VERCEL_CRON=true`.


## Erreur Discord Developer: "interactions_endpoint_url n'a pas pu être vérifiée"

Checklist:

1. `Interactions Endpoint URL` doit être exactement:
   `https://<ton-projet>.vercel.app/api/interactions`
2. Variable Vercel `DISCORD_PUBLIC_KEY` = **Public Key** de ton app Discord (copie exacte).
3. `DISCORD_SKIP_SIGNATURE_CHECK=false` en production.
4. Redéploie Vercel après avoir modifié les variables d'environnement.

Astuce debug: si la signature est invalide, l'API renvoie maintenant un JSON avec un `hint` explicite.


## Dépannage: rien n'apparaît quand tu tapes `/`

Si `/create-event` (ou `/createevent`) n'apparaît pas dans l'autocomplete Discord, les commandes ne sont pas encore enregistrées sur ton serveur.

### Option simple (copier-coller en 3 commandes)

> Remplace uniquement `<BOT_TOKEN>` avec le token de ton bot. L'ID de guilde ci-dessous est déjà ton serveur (`1405913747221905469`).

```bash
cd /workspace/Test/bot
export DISCORD_TOKEN="<BOT_TOKEN>"
export CLIENT_ID="1473058783008653413"
export GUILD_ID="1405913747221905469"
npm run register:commands
npm run check:commands
```

### Ce que ça fait exactement

- `register:commands` publie les slash commands dans **ton serveur** (effet quasi immédiat).
- `check:commands` affiche la liste des commandes enregistrées pour vérifier que `/create-event`, `/createevent`, `/setup-events`, `/my-events`, `/cancel-event` et `/dashboard` sont bien présentes.

### Si ça ne marche toujours pas

1. Vérifie que le bot est bien invité avec le scope `applications.commands`.
2. Lance l'endpoint d'enregistrement Vercel (scope guilde):
   `https://<ton-projet>.vercel.app/api/register-commands?secret=<COMMANDS_SECRET>&guild_id=1405913747221905469`
3. Réouvre Discord (ou fais `Ctrl+R`) pour rafraîchir l'autocomplete.
4. Vérifie que tu tapes `/` dans un salon où le bot a accès.

### Important

- Le bot peut apparaître **hors ligne** en mode interactions serverless: c'est normal.
- Dans ton outil de test cron, remplace `TON_CRON_SECRET` par la vraie valeur de ta variable `CRON_SECRET` (sinon 401 Unauthorized garanti).
