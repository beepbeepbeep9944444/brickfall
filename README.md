# Brickfall

A fast, block-built PvP game that runs in the browser. Pick a free-for-all mode, fight real players
online with faithful 1.8.9-style combat, level up, spend coins on skins, capes and ranks, and climb the
leaderboards.

## Multiplayer

**Play** puts you in an online room for the chosen mode, with up to 12 real players. Rooms are topped
up with **server bots** until there are 8 fighters, and bots leave as players join. The Tab list marks
bots with `BOT`. **Practice offline against bots** is a separate button: just you and local bots,
with nothing saved. The game also falls back to practice if it can't reach the server.

How it works (`server/game/`):

- **WebSocket** at `/ws`, using a small built-in implementation (`server/ws.js`), so there are still no
  npm dependencies. The server runs every room at 20 ticks per second and sends each player a
  snapshot every tick.
- **Movement:** each player moves their own character, so it feels instant, and streams it to the
  server. The server rejects impossible moves (more than 4.5 blocks between updates, except pearls
  and respawns) and snaps the player back.
- **Combat is server-authoritative:**
  - Players only *claim* hits. The server checks reach and rate, then works out the damage itself:
    hurt resistance, armor, blocking, crits, absorption and knockback.
  - It also handles health, regeneration, kills and assists, rewards, consumables (potions, flasks,
    pearls), the respawn timer and placed blocks.
  - Knockback is sent to the victim's game to apply.
- **Stats:** the server records kills, deaths, coins and XP straight to the database, so the online
  leaderboards no longer depend on numbers the browser reports.
- **Server bots** share the world and physics code with the browser (`public/js/world`,
  `public/js/game/physics.js`). They fight in melee only, with the same easy difficulty.
- **One connection per account.** Joining from a second tab replaces the first.

Rooms live in memory, so run **one** server instance. Several instances would each have their own
rooms.

## Game modes

Every mode is a free-for-all with its own map, kit and leaderboard. Pick one on the title screen.

| Mode          | Map             | Kit and rules |
| ------------- | --------------- | ------------- |
| **Arena FFA** | Brickfall Arena | Sword, fishing rod, bow, golden flasks, blocks. Safe spawn tower. |
| **Pot PvP**   | Sandstone Ruins | Diamond-tier sword and armor, 24 **Healing Splash II** potions, 2 **Swiftness II** potions, 4 **Void Pearls**. No natural regen. |
| **Sumo FFA**  | Sky Ring        | Fists only, no damage. Knock players off a floating ring. Falls count as kills for whoever hit them last. |
| **Combo FFA** | Brick Pit       | Sword, 8 golden flasks, heavy armor, 5-tick hurt resistance and lighter knockback, so combos chain. |

- **Healing Splash II:** thrown 20° above the crosshair at 0.5 blocks/tick. It heals everyone within
  4 blocks by `round(8 × (1 − distance / 4))`, or a full 8 on a direct hit. Look down to pot yourself.
- **Swiftness II:** hold right-click to drink. Gives +40% ground speed for 1:30.
- **Void Pearl:** thrown at 1.5 blocks/tick. It teleports you where it lands and costs 5 HP.
- Modes without a spawn tower give 2 seconds of **spawn protection**, which ends early if you attack.
- Bots play each mode: they pot at their feet in Pot PvP, drink flasks in Combo, and steer away from the edge in Sumo.

## Combat (1.8.9 rules)

- The game simulates at **20 ticks per second** using the classic movement constants: walk 4.317 b/s,
  sprint 5.612 b/s, jump 0.42, gravity 0.08, ground friction 0.546, air 0.91. Rendering interpolates
  between ticks.
- **Knockback:** victim velocity halved, then 0.4 away and 0.4 up. Sprint hits add 0.5 along the
  attacker's facing (+0.1 up) and slow the attacker to 60%.
- **Hurt resistance:** 20 ticks. A stronger hit during the first 10 deals only the difference.
- **Crits** while falling (×1.5). **Sword blocking** turns damage into (1 + dmg) / 2. Armor uses
  `dmg × (25 − points) / 25`.
- **Fishing rod:** 0-damage hit with knockback, the classic combo reset. **Bow:** damage =
  ceil(impact speed × 2). **Golden flask:** Regeneration II for 5 s plus 2 absorption hearts.
- **Health:** natural regen of 1 HP every 4 s. Fall damage is `ceil(distance − 3)`, except the drop
  from the spawn tower.
- **Sprinting:** hold Ctrl or Shift to re-sprint automatically, or double-tap W (then you have to
  W-tap). F5 switches to third person.

## Progression & shop

- **Coins and XP** come from kills. Coins get a bonus on a streak and from your rank. XP is
  `20 + 2 × streak` (the streak part caps at 10).
- **Levels** come from lifetime XP (level n → n+1 costs `100 + 20 × (n − 1)` XP). Levels show as a
  coloured `[12]` before your name, with new colours at 10, 20, 30, 40, 50, 75 and 100.
- **Ranks** are bought with coins in the Wardrobe. Upgrading only costs the difference:

  | Rank      | Price   | Coin bonus | Exclusive skin / cape        |
  | --------- | ------- | ---------- | ---------------------------- |
  | `[ACE]`   | 2,500   | +10%       | Sky Pilot / Ace              |
  | `[HERO]`  | 7,500   | +25%       | Guardian / Hero (+ Ace perks) |
  | `[TITAN]` | 15,000  | +50%       | Titan King / Titan (+ all)   |

- **Staff ranks** (MOD, ADMIN, OWNER) are granted by you. They override purchased ranks and unlock
  everything.
- **Skins** are fixed designs. Rowan and Ivy are free; the others cost 750–4,000 coins or come with a
  rank.
- **Capes** cost 1,000–5,000 coins. Some can't be bought: rank capes, Lightning (10-kill streak),
  Founder (accounts created before 2027) and Staff.
- Hold **Tab** in game to see everyone in the arena, highest rank first.
- The catalog, prices and unlock rules live in `public/js/shared/cosmetics.js`, which the browser
  and the server both import. The server re-checks every purchase and equip, so editing requests
  can't get you free items.

Admin tools (run them where the database lives):

```bash
npm run rank -- SomePlayer ADMIN     # staff: MOD | ADMIN | OWNER
npm run rank -- SomePlayer TITAN     # grant a purchasable rank for free
npm run rank -- SomePlayer none      # remove ranks
npm run coins -- SomePlayer 5000     # give (or take, with a negative number) coins
```

## Accounts, guests and chat

- **Guests can play**, but nothing is saved. Before a guest's first match each visit, they see a
  "Save your progress" screen. In game they get reminders as they earn coins, a note on the death
  screen, and a sign-up button in the pause menu. Signing up mid-match saves everything from then on.
- **Sign up** with a username and password. The **email is optional**. If one is given, it's stored
  lowercase, must be unique, and works instead of the username to log in. Players can add, change or
  remove it in Account. Emails never appear anywhere public. They're **not verified**, because the
  server can't send mail, so there's no password reset by email yet.
- **Chat** (press **T** or **Enter**): one global channel. Messages show the sender's level and rank,
  plus a tag when they're playing a different mode. Bots never chat.
  - Anyone can read, but only signed-in players can send.
  - The filter removes links, emails and phone numbers, and stars out bad words (the same lists as
    the username filter).
  - Limits: 100 characters, one message per 1.2 s, 5 per 15 s, and no repeats.
  - `/ignore name` hides a player (just for you). Staff (MOD and up) can `/mute name [minutes]` and
    `/unmute name`.
  - Players can turn chat off in Options → Controls.

## Phones and tablets

Touch devices get on-screen controls:
- a stick on the left (push it to the edge to sprint)
- drag anywhere to look
- **Hit** (hold to keep swinging), **Use** and **Jump** buttons
- tap a hotbar slot to switch items

The game goes fullscreen when a match starts and asks portrait players to turn the device sideways.

## CrazyGames

The CrazyGames build turns on their **HTML5 SDK v3**:

- **Account integration:** players signed in to CrazyGames are signed in automatically. The SDK
  gives the game a signed user token. The server checks it against CrazyGames' public key and links
  it to a Brickfall account, which is created on the first visit. Progress saves to that account.
  Our own username/password form is hidden there: "Sign up" opens CrazyGames' login instead, as
  their rules require.
- **Gameplay events:** `loadingStart/Stop` while the game boots, `gameplayStart/Stop` when a match is
  playing or paused, and `happytime` on level-up.
- **Audio:** the game follows CrazyGames' mute setting (`muteAudio`). It also follows their
  `disableChat` setting.

To publish:

1. Deploy the server somewhere public over HTTPS (see Deploying), with
   `CORS_ORIGINS=https://*.crazygames.com`.
2. Run `npm run build:crazygames -- https://your-server.example.com`.
3. Zip the **contents** of `dist/crazygames/` and upload them as an HTML5 game.

To try it locally, open <http://localhost:8123/?platform=crazygames>. The SDK runs in its "local"
mode with a demo user.

The build talks to your server cross-origin. Builds hosted elsewhere sign in with a bearer token
(kept in the browser's localStorage) instead of the cookie, and CORS never allows credentials.

## Leaderboards

One board per game mode (every mode in `public/js/shared/modes.js` appears in the sidebar),
ranked by kills, with **Daily**, **Weekly** and **Lifetime** tabs. Each board shows a podium for the
top three with face avatars, the full table, and your own position pinned at the bottom.

All art and sound is generated in code. There are no image or audio assets, and the server has no npm
dependencies.

## Quick start

Requires **Node.js 22.5 or newer**.

```bash
npm start
```

Open <http://localhost:8123>. The game must be opened through the server, because its scripts are ES
modules and need an account API.

| Command       | What it does                                   |
| ------------- | ---------------------------------------------- |
| `npm start`   | Run the server                                 |
| `npm run dev` | Run the server and restart it when server code changes |
| `npm test`    | Run the API, cosmetics and username-filter tests |
| `npm run rank -- <name> <RANK\|none>` | Grant or remove a rank |
| `npm run coins -- <name> <amount>` | Give or take coins |
| `npm run build:crazygames -- <server URL>` | Build the copy you upload to CrazyGames |

## Project layout

```
public/                 Everything the browser loads
  index.html            Page markup (HUD and all screens)
  css/                  base.css (design tokens + components), hud.css, screens.css
  js/
    main.js             Boot sequence and main loop
    core/               Utilities, shared state, settings, input, audio, event bus
    render/             Three.js scene, textures, icons, held items, camera
    world/              Voxel map, generation, meshing, player-placed blocks
    game/               Physics, fighters, combat, mode rules + loader, bots, projectiles, player controller
    net/                API client, account state, multiplayer connection, CrazyGames SDK
    shared/             Game modes, cosmetics catalog + unlock rules (also imported by the server)
    ui/                 Screens, HUD, menus, options, auth, leaderboard, account, wardrobe, chat, touch controls
server/
  index.js              HTTP server, routing, graceful shutdown
  routes.js             JSON API
  auth.js               Passwords (scrypt), sessions (cookie or bearer token), email checks
  chat.js               Chat stream, sending, mutes
  crazygames.js         CrazyGames token verification and account linking
  ws.js                 Minimal WebSocket server
  game/                 Online rooms: connections, server-side combat and stats, server bots
  db.js                 SQLite schema, migrations and queries
  leaderboard.js        Rankings and match-report limits
  names.js              Username rules, name and chat filters
  http.js, static.js    Helpers, security headers, static files
scripts/                Admin commands (set-rank, give-coins) and the CrazyGames build
test/                   node:test suites
```

Game modules talk to the UI through a small event bus (`public/js/core/events.js`), so gameplay
code never imports interface code.

## Configuration

All settings are environment variables (see `.env.example`):

| Variable           | Default    | Notes                                                        |
| ------------------ | ---------- | ------------------------------------------------------------ |
| `PORT`             | `8123`     |                                                              |
| `HOST`             | `0.0.0.0`  |                                                              |
| `DATA_DIR`         | `./data`   | Where the SQLite database lives. **Must persist** in production. |
| `NODE_ENV`         | —          | `production` switches logs to JSON lines                     |
| `TRUST_PROXY`      | off        | Set to `1` behind a reverse proxy (Railway, Render, Fly, nginx) so client IPs and HTTPS are detected |
| `SECURE_COOKIES`   | off        | Force the `Secure` cookie flag                               |
| `SESSION_DAYS`     | `30`       | How long a login lasts                                       |
| `LOG_REQUESTS`     | on         | Set to `0` to silence request logs                           |
| `ROOM_FIGHTERS`    | `8`        | Online rooms are topped up with bots to this many fighters (`0` = real players only) |
| `CORS_ORIGINS`     | —          | Other sites allowed to call the API, comma-separated. Use `https://*.crazygames.com` for the CrazyGames build |
| `CRAZYGAMES_PUBLIC_KEY` | fetched | PEM key for CrazyGames user tokens. Normally fetched from `CRAZYGAMES_PUBLIC_KEY_URL` and cached for an hour |

## API

| Method | Path                     | Description                                 |
| ------ | ------------------------ | ------------------------------------------- |
| GET    | `/healthz`               | Health check (`{ ok, version, uptime }`)    |
| POST   | `/api/register`          | `{ name, password, email? }` → creates account, signs in |
| POST   | `/api/login`             | `{ name, password }`, where `name` can be the username or email |
| POST   | `/api/auth/crazygames`   | `{ token }` from the CrazyGames SDK → signs in to the linked account |
| POST   | `/api/account/email`     | `{ password, email }`; an empty email removes it |
| GET    | `/api/chat/stream`       | Server-Sent Events: `history`, then each `message` |
| GET    | `/api/online`            | Players online per mode                    |
| GET    | `/ws`                    | WebSocket game connection (first message: `{ t: 'hello', mode, name?, cos?, token? }`) |
| POST   | `/api/chat/send`         | `{ text, mode }`, signed-in players only |
| POST   | `/api/logout`            |                                             |
| GET    | `/api/me?mode=arena`     | Current user, rank, stats, unlock progress and cosmetics |
| POST   | `/api/cosmetics`         | `{ cosmetics: { skin, cape } }`; items you don't own fall back to defaults |
| POST   | `/api/shop/buy`          | `{ kind: 'skin' \| 'cape' \| 'rank', id }`, paid from your coin balance |
| POST   | `/api/account/password`  | `{ currentPassword, newPassword }`, signs out other devices |
| POST   | `/api/account/delete`    | `{ password }`, deletes the account and stats |
| GET    | `/api/leaderboard`       | `mode`, `period` (`day`/`week`/`all`), `limit`; ranked by kills |
| POST   | `/api/match/start`       | `{ mode }` → `{ matchId }`                  |
| POST   | `/api/match/report`      | Stat changes since the last report          |

## Security notes

- Passwords are hashed with scrypt. Session tokens are random, and only their SHA-256 is stored.
- Cookies are `HttpOnly` and `SameSite=Lax`. POSTs must be JSON and come from the same origin.
- Responses carry a strict Content-Security-Policy and the other standard hardening headers.
- Sign-up, login and reporting are rate limited per IP. Chat is rate limited per account.
- Login, sign-up and the API accept a bearer token (for builds on other sites) as well as the
  cookie. Cross-origin requests are only allowed from `CORS_ORIGINS` and never carry cookies.
- **Children:** the game is aimed at a young audience. Chat filtering is basic: it catches common
  words and personal info, not a determined troll. In the US, collecting email addresses from
  under-13s needs parental consent (COPPA), which is one reason email is optional. Check what applies
  where you publish.
- Online fights are refereed by the server, which records stats itself. Movement is still
  client-driven with plausibility checks, so speed or fly hacks are limited but not impossible. The
  old `/api/match/*` endpoints (browser-reported stats) remain for compatibility, but the game no
  longer uses them.

## Deploying

The server is a single Node process with a SQLite file, so any host that runs Node and gives you a
persistent disk works.

**Docker**

```bash
docker build -t brickfall .
docker run -p 8123:8123 -v brickfall-data:/data brickfall
```

The host must allow **WebSockets** (Railway, Render and Fly.io do; behind nginx, forward the
`Upgrade` and `Connection` headers).

**Railway / Render / Fly.io**: point the service at this repo with start command `npm start`, and set
`NODE_ENV=production` and `TRUST_PROXY=1`. Attach a persistent volume and set `DATA_DIR` to its mount
path, or every redeploy wipes the leaderboard.

## Adding a game mode

1. Add the name, icon and description to `public/js/shared/modes.js`. The server, menu and
   leaderboard pick it up from there.
2. Add the kit and rules to `public/js/game/rules.js`: damage, armor, hurt resistance, knockback,
   regen, spawn type and what the bots carry.
3. Add a map generator to `MAPS` in `public/js/world/world.js`, and point the rule's `map` at it.

Each mode keeps its own leaderboard automatically.
