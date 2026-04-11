# 🃏 Durendal — MTG Discord Bot

> *Your personal Magic: The Gathering homie, living right inside your Discord server.*

---

So I built this Discord bot that lets you look up Magic cards, find commander synergies, and check what decks are slapping in the current meta — all without leaving Discord. Pretty sick, right? Here's everything you need to know to get it running, even if you've never touched a Discord bot before.

---

## ✨ What It Can Do

| Command | What it does |
|---|---|
| `/get` | Look up any MTG card — art, stats, price, the works |
| `/synergy` | Give it a Commander and it'll find cards that vibe with it |
| `/stndmeta` | Top 5 Standard meta decks right now |
| `/cmdrmeta` | Top 5 cEDH Commander meta decks right now |
| `/mdrnmeta` | Top 5 Modern meta decks right now |
| `/upcomingsets` | A list of upcoming sets and variations of said new sets along with release dates |

All card data comes from **Scryfall** (free, no key needed) and meta data comes from **MTGGoldfish**. No sketchy stuff.

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
✅ /get, /synergy, /stndmeta, /cmdrmeta, /mdrnmeta registered globally.
✅ Logged in as YourBotName#1234
```

Head to your Discord server and try typing `/get` — the command should pop up!

---

## 🃏 Using the Commands

### `/get`
Look up any card by name. Partial names work too.
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

### `/stndmeta`
No options needed, just run it:
```
/stndmeta
```
Pulls the top 5 Standard meta decks from MTGGoldfish. Shows meta share %, price, and a link to the full decklist.

---

### `/cmdrmeta`
Same deal but for competitive EDH (cEDH):
```
/cmdrmeta
```

---

### `/mdrnmeta`
Same deal but for Modern:
```
/mdrnmeta
```

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

---

## 📦 Dependencies

| Package | What it's for |
|---|---|
| `discord.js` | The main Discord bot framework |
| `@discordjs/rest` | Handles slash command registration |
| `discord-api-types` | Type definitions for the Discord API |
| `dotenv` | Loads your `.env` credentials |
| `cheerio` | Scrapes metagame data from MTGGoldfish |

---

## 📜 License

Do whatever you want with it. Add commands, change the colors, make it your own. That's the whole point.

---

*Built with too much caffeine and a love for both coding and Magic. gl hf* ✌️
