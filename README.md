# 🃏 Durendal — MTG Discord Bot

> *Your personal Magic: The Gathering homie, living right inside your Discord server.*

---

So I built this Discord bot that lets you look up Magic cards, find commander synergies, dig up infinite combos, read official rulings, track upcoming spoilers, and check what decks are slapping across every major format — all without leaving Discord. Pretty sick, right? Here's everything you need to know to get it running, even if you've never touched a Discord bot before.

---

## ✨ What It Can Do

### 🃏 Card & Deck Tools
| Command | What it does |
|---|---|
| `/get` | Look up any MTG card — art, stats, price, the works |
| `/synergy` | Give it a Commander and it'll find cards that vibe with it |
| `/combo` | Infinite combos featuring a card (via Commander Spellbook) |
| `/rulings` | Official rulings for any card (via Scryfall) |

### 🆕 Set & Spoiler Info
| Command | What it does |
|---|---|
| `/upcomingsets` | Next 10 upcoming MTG set release dates |
| `/spoilers` | Latest previewed cards from the upcoming set (or a set you pick) |

### 🏆 Metagame (Top 5 decks, last 90 days)
| Command | Format |
|---|---|
| `/stndmeta` | Standard |
| `/mdrnmeta` | Modern |
| `/pioneer` | Pioneer |
| `/pauper` | Pauper (commons-only) |
| `/legacy` | Legacy |
| `/vintage` | Vintage |
| `/cmdrmeta` | cEDH Commander |

### 🖱️ Context Menu
Right-click (or tap-and-hold on mobile) any message → **Apps** → **Lookup MTG Cards**. The bot scans the message for `[[card name]]` references and replies with full card info — perfect for decklists and quick references.

---

Card data comes from **[Scryfall](https://scryfall.com)**, combos come from **[Commander Spellbook](https://commanderspellbook.com)**, and metagame data is scraped from **[MTGTop8](https://www.mtgtop8.com)**. All free, all public, no API keys required.

---

## 🛠️ What You Need Before Starting

Don't panic, this list is short:

- **[Node.js](https://nodejs.org/)** — version 18 or higher. Just download it and install it like any normal program. If you're not sure what version you have, open a terminal and type `node -v`.
- **A Discord account** — you probably already have one.
- **A Discord server** you have admin access to — so you can actually add the bot.

That's it. Really.

---

## 🤖 Step 1 — Create Your Bot on Discord

This is the part that looks scary but honestly takes like 5 minutes.

1. Go to **[discord.com/developers/applications](https://discord.com/developers/applications)** and log in
2. Hit **"New Application"** — give it a name (I called mine Durendal, feel free to be creative)
3. On the left sidebar click **"Bot"**, then hit **"Add Bot"**
4. Under the bot's username, click **"Reset Token"** and copy that token — paste it somewhere safe, you'll need it in a sec
5. Scroll down and make sure **"Message Content Intent"** is toggled ON
6. On the left sidebar click **"OAuth2"** → **"General"** and copy your **Client ID** (this is your `APPLICATION_ID`)

Now to invite it to your server:
1. Go to **"OAuth2"** → **"URL Generator"**
2. Check **"bot"** and **"applications.commands"**
3. Under bot permissions check **"Send Messages"**, **"Embed Links"**, **"Use Slash Commands"**
4. Copy the generated URL at the bottom, paste it in your browser, and add it to your server

---

## 📁 Step 2 — Set Up the Project

Download or clone the files into a folder on your computer. Your folder should look like this:

```
mtgbot/
├── index.js
├── package.json
├── .env          ← your secret credentials go here
└── .gitignore
```

Open a terminal, navigate to your folder, and run:

```bash
npm install
```

This grabs all the libraries the bot needs. You'll see a `node_modules` folder appear — that's normal, don't touch it.

---

## 🔐 Step 3 — Fill In Your .env File

Open the `.env` file and fill in your details:

```env
DISCORD_TOKEN=paste_your_bot_token_here
APPLICATION_ID=paste_your_application_id_here

# GUILD_ID is optional — explained below
GUILD_ID=
```

**About GUILD_ID:**
- If you leave it **blank**, your commands register globally (works in any server, but takes up to 1 hour to show up)
- If you paste your **server's ID** here, commands show up instantly in that server only

To find your Server ID: open Discord → Settings → Advanced → enable **Developer Mode** → right-click your server name → **Copy Server ID**

> ⚠️ **Never share your `.env` file or your bot token with anyone.** Treat it like a password. The `.gitignore` file makes sure it won't get accidentally uploaded to GitHub.

---

## 🚀 Step 4 — Run It

```bash
node index.js
```

If everything went right you'll see something like:

```
⏳ Registering slash commands...
✅ /get, /synergy, /stndmeta, /cmdrmeta, /mdrnmeta, /pioneer, /pauper, /legacy, /vintage, /upcomingsets, /combo, /rulings, /spoilers + "Lookup MTG Cards" (context) registered globally.
✅ Logged in as YourBotName#1234
```

Head to your Discord server and try typing `/get` — the command should pop up!

---

## 🃏 Using the Commands

### `/get`
Look up any card by name. Partial names work too, and autocomplete will suggest as you type.
```
/get card:Lightning Bolt
/get card:Bolt          ← still finds it
/get card:Black Lotus set:lea   ← filter by set code
```
You'll get back the card art, mana cost, type, oracle text, flavor text, power/toughness, set info, and current market prices.

---

### `/synergy`
Give it your Commander and it'll suggest cards that work well with it.
```
/synergy commander:Atraxa, Praetors Voice
/synergy commander:Ur-Dragon results:30
```
Results are paginated — use the ◀ ▶ buttons to flip through pages. Each card comes with a short reason explaining why it fits.

---

### `/combo`
Find infinite combos featuring a card, pulled from Commander Spellbook.
```
/combo card:Thassa's Oracle
/combo card:Dramatic Reversal
```
Shows all the pieces needed, what the combo produces (infinite mana, win the game, etc.), color identity, and a link to the full write-up. Paginated.

---

### `/rulings`
Official rulings for a card — useful for the weird edge cases that always come up.
```
/rulings card:Stasis
/rulings card:Oboro, Palace in the Clouds
```
Each ruling shows its date and source (Wizards of the Coast or Scryfall). Paginated for cards with lots of rulings.

---

### `/spoilers`
Latest previewed cards from the upcoming set — ordered by when they were spoiled.
```
/spoilers                ← auto-picks the next upcoming set
/spoilers set:fdn        ← or specify a set code
```
Shows preview date and source for each card. Perfect for keeping up with preview season.

---

### `/upcomingsets`
No options — just run it:
```
/upcomingsets
```
Shows the next 10 upcoming MTG releases with dates, set types, and urgency emojis (🔥 if it drops within a week).

---

### Metagame commands
All work the same way — no options needed. Each pulls the top 5 decks from MTGTop8 over the last 90 days, with meta share %, a neat ASCII bar graph, and a link to the full deck breakdown.
```
/stndmeta    ← Standard
/mdrnmeta    ← Modern
/pioneer     ← Pioneer
/pauper      ← Pauper
/legacy      ← Legacy
/vintage     ← Vintage
/cmdrmeta    ← cEDH Commander
```

---

### "Lookup MTG Cards" (context menu)
Right-click any message → **Apps** → **Lookup MTG Cards**. The bot scans the message for `[[card name]]` references (up to 5 unique) and posts full card embeds for each. If someone posts a decklist or discusses cards in `[[brackets]]`, this is the fastest way to look them all up at once.

---

## 🐛 Something Broke?

**"Bot is online but commands don't show up"**
→ If GUILD_ID is blank, wait up to an hour for global commands to propagate. Or add your server ID to GUILD_ID and restart.

**"Missing DISCORD_TOKEN or APPLICATION_ID"**
→ Your `.env` file still has the placeholder text. Replace it with your actual values.

**"Value is not snowflake" error**
→ Your GUILD_ID has placeholder text in it. Either fill in a real server ID or leave it completely blank.

**"Failed to register commands"**
→ Double-check your bot token and application ID are correct in `.env`.

**Meta commands return no data**
→ MTGTop8 may be temporarily down or may have updated their page layout. Try again in a bit.

**Autocomplete isn't showing suggestions**
→ Autocomplete needs at least 2 characters before it fires. If it still doesn't work, the bot process may be down — check your terminal.

**"Lookup MTG Cards" doesn't appear in the Apps menu**
→ Global commands can take up to an hour to propagate. Either wait it out or set `GUILD_ID` in `.env` to have it register instantly on your server.

---

## ⚡ Quality-of-Life Features

A few things running quietly under the hood that make the bot nicer to use:

- **Autocomplete on card names** — start typing a card or commander and Discord shows live suggestions straight from Scryfall's database. Works on `/get`, `/synergy`, `/combo`, and `/rulings`. No more guessing the spelling of "Ulamog, the Infinite Gyre" or "Jaya Ballard, Task Mage".
- **In-memory LRU cache for Scryfall** — repeated lookups are served from memory for up to 5 minutes. A fresh `/synergy` call fires 8 searches behind the scenes, so this matters: call it twice for the same commander and the second run is basically instant.
- **Per-user cooldowns** — 10 seconds on `/synergy` (it hits Scryfall hard), 3 seconds on everything else. Stops accidental spam and keeps the bot friendly to the free APIs it relies on.
- **Paginated embeds** — `/synergy`, `/combo`, `/rulings`, and `/spoilers` use ◀ ▶ buttons so long result lists stay readable.
- **Fetch safety** — all outbound HTTP calls have a 10s timeout and a 5MB response cap, so a misbehaving upstream can't hang or memory-bomb the bot.

---

## 📦 Dependencies

| Package | What it's for |
|---|---|
| `discord.js` | The main Discord bot framework |
| `@discordjs/rest` | Handles slash command registration |
| `discord-api-types` | Type definitions for the Discord API |
| `dotenv` | Loads your `.env` credentials |
| `cheerio` | Scrapes metagame data from MTGTop8 |

---

## 📜 License

Do whatever you want with it. Add commands, change the colors, make it your own. That's the whole point.

---

*Built with too much caffeine and a love for both coding and Magic. gl hf* ✌️
