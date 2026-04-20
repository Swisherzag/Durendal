// =======================================
// Setup:
//   1. npm install
//   2. Fill in your credentials in .env
//   3. node index.js
// =======================================

require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  SlashCommandBuilder,
  ContextMenuCommandBuilder,
  ApplicationCommandType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const { REST }    = require("@discordjs/rest");
const { Routes }  = require("discord-api-types/v10");
const cheerio     = require("cheerio");

const TOKEN          = process.env.DISCORD_TOKEN;
const APPLICATION_ID = process.env.APPLICATION_ID;
const GUILD_ID       = process.env.GUILD_ID || "";

if (!TOKEN || !APPLICATION_ID) {
  console.error("❌ Missing DISCORD_TOKEN or APPLICATION_ID in .env");
  process.exit(1);
}

const SCRYFALL  = "https://api.scryfall.com";
const PAGE_SIZE = 5;

//  SECURITY: Fetch timeouts + size caps

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES   = 5 * 1024 * 1024;
async function safeFetch(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function safeText(res) {
  const declared = Number(res.headers.get("content-length"));
  if (declared && declared > MAX_BODY_BYTES) {
    throw new Error(`Response too large: ${declared} bytes (cap ${MAX_BODY_BYTES})`);
  }
  const text = await res.text();
  if (text.length > MAX_BODY_BYTES) {
    throw new Error(`Response too large: ${text.length} bytes (cap ${MAX_BODY_BYTES})`);
  }
  return text;
}

async function safeJson(res) {
  return JSON.parse(await safeText(res));
}

// ══════════════════════════════════════════════════════════════
//  SECURITY: Per-user rate limiting
// ══════════════════════════════════════════════════════════════

// Cheap lookups get a short cooldown; /synergy is expensive it gets a little nuts and can trigger multiple Scryfall searches in one go
// (up to 8 Scryfall searches per call) so it gets a longer cooldown to prevent abuse and protect Scryfall's API.
const COOLDOWN_MS = {
  default: 3_000,
  synergy: 10_000,
};

const userCooldowns = new Map(); // `${userId}:${command}` -> timestamp

function checkCooldown(userId, command) {
  const key    = `${userId}:${command}`;
  const window = COOLDOWN_MS[command] ?? COOLDOWN_MS.default;
  const now    = Date.now();
  const last   = userCooldowns.get(key);

  if (last && now - last < window) {
    return Math.ceil((window - (now - last)) / 1000);
  }
  userCooldowns.set(key, now);
  return 0;
}

// Periodically purge stale cooldown entries so the Map can't grow unbounded.
setInterval(() => {
  const now = Date.now();
  const maxWindow = Math.max(...Object.values(COOLDOWN_MS));
  for (const [key, ts] of userCooldowns) {
    if (now - ts > maxWindow * 2) userCooldowns.delete(key);
  }
}, 60_000).unref();

const ALLOWED_MTGTOP8_HOSTS = new Set(["www.mtgtop8.com", "mtgtop8.com"]);

function safeMTGTop8Url(rawHref) {
  if (!rawHref || typeof rawHref !== "string") return MTGTOP8;
  try {
    const url = new URL(rawHref, `${MTGTOP8}/`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return MTGTOP8;
    if (!ALLOWED_MTGTOP8_HOSTS.has(url.hostname)) return MTGTOP8;
    return url.toString();
  } catch {
    return MTGTOP8;
  }
}

// ══════════════════════════════════════════════════════════════
//  SLASH COMMAND DEFINITIONS
// ══════════════════════════════════════════════════════════════

const commands = [
  new SlashCommandBuilder()
    .setName("get")
    .setDescription("Look up a Magic: The Gathering card")
    .addStringOption(opt =>
      opt.setName("card")
         .setDescription("Card name (partial names work too!)")
         .setRequired(true)
         .setAutocomplete(true)
    )
    .addStringOption(opt =>
      opt.setName("set")
         .setDescription("Optional: filter by set code (e.g. 'lea', 'znr')")
         .setRequired(false)
    )
    .toJSON(),

  // /synergy
  new SlashCommandBuilder()
    .setName("synergy")
    .setDescription("Find cards that synergize well in a Commander deck")
    .addStringOption(opt =>
      opt.setName("commander")
         .setDescription("Your Commander's name (e.g. 'Atraxa, Praetors Voice')")
         .setRequired(true)
         .setAutocomplete(true)
    )
    .addIntegerOption(opt =>
      opt.setName("results")
         .setDescription("How many synergy cards to show (default 20, max 40)")
         .setMinValue(5)
         .setMaxValue(40)
         .setRequired(false)
    )
    .toJSON(),

  // /stndmeta
  new SlashCommandBuilder()
    .setName("stndmeta")
    .setDescription("Show the top 5 Standard meta decks from the last 90 days (via MTGGoldfish)")
    .toJSON(),

  // /cmdrmeta
  new SlashCommandBuilder()
    .setName("cmdrmeta")
    .setDescription("Show the top 5 cEDH Commander meta decks from the last 90 days (via MTGGoldfish)")
    .toJSON(),

  // /mdrnmeta
  new SlashCommandBuilder()
    .setName("mdrnmeta")
    .setDescription("Show the top 5 Modern meta decks from the last 90 days (via MTGGoldfish)")
    .toJSON(),

  // /pioneer
  new SlashCommandBuilder()
    .setName("pioneer")
    .setDescription("Show the top 5 Pioneer meta decks from the last 90 days (via MTGTop8)")
    .toJSON(),

  // /pauper
  new SlashCommandBuilder()
    .setName("pauper")
    .setDescription("Show the top 5 Pauper meta decks from the last 90 days (via MTGTop8)")
    .toJSON(),

  // /legacy
  new SlashCommandBuilder()
    .setName("legacy")
    .setDescription("Show the top 5 Legacy meta decks from the last 90 days (via MTGTop8)")
    .toJSON(),

  // /vintage
  new SlashCommandBuilder()
    .setName("vintage")
    .setDescription("Show the top 5 Vintage meta decks from the last 90 days (via MTGTop8)")
    .toJSON(),

  // /upcomingsets
  new SlashCommandBuilder()
    .setName("upcomingsets")
    .setDescription("Show upcoming MTG set release dates (via Scryfall)")
    .toJSON(),

  // /combo
  new SlashCommandBuilder()
    .setName("combo")
    .setDescription("Find infinite combos featuring a card (via Commander Spellbook)")
    .addStringOption(opt =>
      opt.setName("card")
         .setDescription("Card name (partial names work too!)")
         .setRequired(true)
         .setAutocomplete(true)
    )
    .toJSON(),

  // /rulings
  new SlashCommandBuilder()
    .setName("rulings")
    .setDescription("Show official rulings for a Magic card (via Scryfall)")
    .addStringOption(opt =>
      opt.setName("card")
         .setDescription("Card name (partial names work too!)")
         .setRequired(true)
         .setAutocomplete(true)
    )
    .toJSON(),

  // /spoilers
  new SlashCommandBuilder()
    .setName("spoilers")
    .setDescription("Show the latest previewed cards from the upcoming set (via Scryfall)")
    .addStringOption(opt =>
      opt.setName("set")
         .setDescription("Optional: specific set code (e.g. 'fdn'). Default: next upcoming set.")
         .setRequired(false)
    )
    .toJSON(),

  // Context menu: right-click a message → scan for [[card]] references
  new ContextMenuCommandBuilder()
    .setName("Lookup MTG Cards")
    .setType(ApplicationCommandType.Message)
    .toJSON(),
];

// ══════════════════════════════════════════════════════════════
//  COMMAND REGISTRATION
// ══════════════════════════════════════════════════════════════

async function registerCommands() {
  const rest  = new REST({ version: "10" }).setToken(TOKEN);
  const route = GUILD_ID
    ? Routes.applicationGuildCommands(APPLICATION_ID, GUILD_ID)
    : Routes.applicationCommands(APPLICATION_ID);
  try {
    console.log("⏳ Registering slash commands...");
    await rest.put(route, { body: commands });
    console.log(`✅ /get, /synergy, /stndmeta, /cmdrmeta, /mdrnmeta, /pioneer, /pauper, /legacy, /vintage, /upcomingsets, /combo, /rulings, /spoilers + "Lookup MTG Cards" (context) registered ${GUILD_ID ? `to guild ${GUILD_ID}` : "globally"}.`);
  } catch (err) {
    console.error("❌ Failed to register commands:", err);
    process.exit(1);
  }
}

// ══════════════════════════════════════════════════════════════
//  SHARED SCRYFALL HELPERS
// ══════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────
//  LRU cache — in-memory, URL-keyed, with TTL eviction.
//  Soaks up repeat lookups (autocomplete keystrokes, /synergy's
//  8 queries per call, repeated /get's, etc.) without hammering
//  Scryfall. Not persistent: cold on restart.
// ──────────────────────────────────────────────────────────────
class LRU {
  constructor(max, ttlMs) {
    this.max = max;
    this.ttl = ttlMs;
    this.map = new Map();
  }
  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expires) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, entry); // bump to most-recent
    return entry.value;
  }
  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, expires: Date.now() + this.ttl });
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
  }
}

const scryfallCache = new LRU(500, 5 * 60 * 1000); // 500 entries · 5-minute TTL

async function scryfallFetch(url) {
  const cached = scryfallCache.get(url);
  if (cached !== undefined) return cached;

  const res = await safeFetch(url);
  if (!res.ok) return null; // don't cache failures
  const data = await safeJson(res);
  scryfallCache.set(url, data);
  return data;
}

async function scryfallAutocomplete(query) {
  const url  = `${SCRYFALL}/cards/autocomplete?q=${encodeURIComponent(query)}`;
  const data = await scryfallFetch(url);
  return Array.isArray(data?.data) ? data.data : [];
}

async function scryfallSearch(query, n = 10) {
  const url  = `${SCRYFALL}/cards/search?q=${encodeURIComponent(query)}&order=edhrec&unique=cards`;
  const data = await scryfallFetch(url);
  if (!data?.data) return [];
  return data.data.slice(0, n);
}

const RARITY_COLOR = {
  common:   0x9E9E9E,
  uncommon: 0x78909C,
  rare:     0xFFD700,
  mythic:   0xFF6600,
  special:  0x9C27B0,
  bonus:    0xAB47BC,
};

// ══════════════════════════════════════════════════════════════
//  /get — CARD LOOKUP
// ══════════════════════════════════════════════════════════════

async function fetchCard(name, setCode) {
  let url = `${SCRYFALL}/cards/named?fuzzy=${encodeURIComponent(name)}`;
  if (setCode) url += `&set=${encodeURIComponent(setCode)}`;

  const res = await safeFetch(url);
  if (!res.ok) {
    if (res.status === 404) {
      const searchRes = await safeFetch(
        `${SCRYFALL}/cards/search?q=${encodeURIComponent(name)}&order=name&limit=5`
      );
      if (searchRes.ok) {
        const searchData = await safeJson(searchRes);
        const suggestions = searchData.data.map(c => `\`${c.name}\``).join(", ");
        return { error: `Card not found. Did you mean: ${suggestions}?` };
      }
      return { error: `No card found matching **"${name}"**.` };
    }
    return { error: `Scryfall API error: ${res.status}` };
  }
  return safeJson(res);
}

function buildCardEmbed(card) {
  const color    = RARITY_COLOR[card.rarity] ?? 0x1A1A2E;
  const face     = card.card_faces?.[0] ?? card;
  const backFace = card.card_faces?.[1] ?? null;
  const imageUrl = face.image_uris?.normal ?? card.image_uris?.normal ?? null;

  const manaCost   = (face.mana_cost ?? card.mana_cost ?? "—")
    .replace(/\{/g, "").replace(/\}/g, " ").trim() || "—";
  const typeLine   = face.type_line   ?? card.type_line   ?? "Unknown Type";
  const oracleText = face.oracle_text ?? card.oracle_text ?? "";
  const flavorText = face.flavor_text ?? card.flavor_text ?? "";
  const power      = face.power       ?? card.power;
  const toughness  = face.toughness   ?? card.toughness;
  const loyalty    = face.loyalty     ?? card.loyalty;
  const setName    = card.set_name    ?? "Unknown Set";
  const setCode    = (card.set ?? "").toUpperCase();
  const rarity     = card.rarity
    ? card.rarity.charAt(0).toUpperCase() + card.rarity.slice(1)
    : "Unknown";
  const artist     = face.artist ?? card.artist ?? "Unknown";
  const prices     = card.prices ?? {};

  const embed = new EmbedBuilder()
    .setTitle(`${card.name}  ${manaCost !== "—" ? `· ${manaCost}` : ""}`)
    .setURL(card.scryfall_uri ?? "")
    .setColor(color)
    .setDescription(
      [
        `**${typeLine}**`,
        oracleText ? `\n${oracleText}` : "",
        flavorText ? `\n*${flavorText}*` : "",
      ].join("")
    )
    .addFields(
      { name: "Set",    value: `${setName} (${setCode})`, inline: true },
      { name: "Rarity", value: rarity,                    inline: true },
      { name: "Artist", value: artist,                    inline: true }
    );

  if (power !== undefined && toughness !== undefined)
    embed.addFields({ name: "Power / Toughness", value: `${power} / ${toughness}`, inline: true });
  if (loyalty !== undefined)
    embed.addFields({ name: "Starting Loyalty", value: loyalty, inline: true });

  const priceLines = [];
  if (prices.usd)      priceLines.push(`Paper: **$${prices.usd}**`);
  if (prices.usd_foil) priceLines.push(`Foil:  **$${prices.usd_foil}**`);
  if (prices.eur)      priceLines.push(`EUR:   **€${prices.eur}**`);
  if (prices.tix)      priceLines.push(`MTGO:  **${prices.tix} tix**`);
  if (priceLines.length)
    embed.addFields({ name: "💰 Market Prices", value: priceLines.join("\n"), inline: false });

  if (backFace) {
    embed.addFields({
      name: `↩ Back Face: ${backFace.name}`,
      value: [
        backFace.type_line   ? `**${backFace.type_line}**` : "",
        backFace.oracle_text ?? "",
      ].filter(Boolean).join("\n") || "—",
      inline: false,
    });
  }

  if (imageUrl) embed.setThumbnail(imageUrl);
  embed.setFooter({ text: `Collector #${card.collector_number ?? "?"}  ·  via Scryfall` });
  return embed;
}

// ══════════════════════════════════════════════════════════════
//  /synergy — COMMANDER SYNERGY
// ══════════════════════════════════════════════════════════════

function colorIdentityFilter(colors) {
  if (!colors || colors.length === 0) return "id:c";
  return `id<=${colors.join("")}`;
}

function buildQueries(commander, colorFilter) {
  const queries = [];
  const face    = commander.card_faces?.[0] ?? commander;
  const type    = (face.type_line    ?? commander.type_line    ?? "").toLowerCase();
  const text    = (face.oracle_text  ?? commander.oracle_text  ?? "").toLowerCase();
  const kws     = (commander.keywords ?? []).map(k => k.toLowerCase());

  queries.push({
    q: `${colorFilter} f:commander is:highsynergy`,
    reason: "high-synergy staples in your color identity",
  });

  const creatureTypes = [
    "vampire","zombie","dragon","elf","goblin","merfolk","angel","demon",
    "human","wizard","knight","soldier","elemental","spirit","sliver",
    "dinosaur","pirate","cat","cleric","shaman","warrior","faerie",
    "hydra","horror","beast",
  ];
  for (const ct of creatureTypes) {
    if (type.includes(ct)) {
      queries.push({ q: `${colorFilter} t:${ct} f:commander`,    reason: `tribal synergy — shares the **${ct}** type` });
      queries.push({ q: `${colorFilter} o:"${ct}" f:commander`,  reason: `references **${ct}s** in its effect` });
    }
  }

  if (text.includes("counter") || kws.includes("proliferate")) {
    queries.push({ q: `${colorFilter} o:proliferate f:commander`,        reason: "**proliferate** to spread counters" });
    queries.push({ q: `${colorFilter} o:"+1/+1 counter" f:commander`,    reason: "+1/+1 **counter** synergy" });
  }
  if (text.includes("graveyard") || text.includes("flashback") || text.includes("unearth")) {
    queries.push({ q: `${colorFilter} o:graveyard f:commander`, reason: "**graveyard** recursion engine" });
  }
  if (text.includes("life") || kws.includes("lifelink")) {
    queries.push({ q: `${colorFilter} o:"gain life" f:commander`, reason: "**lifegain** triggers and payoffs" });
  }
  if (text.includes("sacrifice") || text.includes("dies")) {
    queries.push({ q: `${colorFilter} o:sacrifice f:commander`,                    reason: "**sacrifice** / aristocrats payoff" });
    queries.push({ q: `${colorFilter} o:"whenever a creature dies" f:commander`,   reason: "**death trigger** synergy" });
  }
  if (text.includes("token") || text.includes("create")) {
    queries.push({ q: `${colorFilter} o:token f:commander`, reason: "**token** generation & anthem effects" });
  }
  if (text.includes("instant") || text.includes("sorcery") || text.includes("storm") || text.includes("cast")) {
    queries.push({ q: `${colorFilter} o:"whenever you cast" f:commander`, reason: "**spells-matter** triggers" });
  }
  if (text.includes("draw")) {
    queries.push({ q: `${colorFilter} o:"draw a card" f:commander`, reason: "**card draw** engine" });
  }
  if (text.includes("artifact") || type.includes("artifact")) {
    queries.push({ q: `${colorFilter} o:artifact f:commander t:artifact`, reason: "**artifact** synergy" });
  }
  if (text.includes("enchantment") || type.includes("enchantment")) {
    queries.push({ q: `${colorFilter} o:enchantment f:commander t:enchantment`, reason: "**enchantment** synergy" });
  }
  if (text.includes("landfall") || text.includes("land enters")) {
    queries.push({ q: `${colorFilter} o:landfall f:commander`, reason: "**landfall** triggers" });
  }
  if (text.includes("equipment") || text.includes("equip")) {
    queries.push({ q: `${colorFilter} t:equipment f:commander`, reason: "**equipment** for voltron builds" });
  }

  queries.push({ q: `${colorFilter} o:"add mana" f:commander t:land`,        reason: "**mana ramp** lands" });
  queries.push({ q: `${colorFilter} o:"search your library" f:commander`,    reason: "**tutors** to find key pieces" });

  const seen = new Set();
  return queries.filter(q => {
    if (seen.has(q.q)) return false;
    seen.add(q.q);
    return true;
  }).slice(0, 8);
}

async function fetchSynergyCards(commander, maxResults) {
  const colorFilter = colorIdentityFilter(commander.color_identity);
  const queries     = buildQueries(commander, colorFilter);
  const seen        = new Set([commander.name]);
  const results     = [];

  for (const { q, reason } of queries) {
    if (results.length >= maxResults) break;
    const cards = await scryfallSearch(q, 10);
    for (const card of cards) {
      if (seen.has(card.name)) continue;
      seen.add(card.name);
      results.push({ card, reason });
      if (results.length >= maxResults) break;
    }
  }
  return results;
}

function buildSynergyEmbed(commander, picks, page, totalPages) {
  const cmdrFace  = commander.card_faces?.[0] ?? commander;
  const cmdrImage = cmdrFace.image_uris?.art_crop ?? commander.image_uris?.art_crop ?? null;
  const colors    = (commander.color_identity ?? []).join("") || "C";

  const embed = new EmbedBuilder()
    .setTitle(`⚔️ Commander Synergy: ${commander.name}`)
    .setDescription(
      `Color Identity: **${colors}**  ·  ${cmdrFace.type_line ?? commander.type_line ?? ""}\n` +
      `Showing **${picks.length}** synergy picks — page **${page + 1}** of **${totalPages}**`
    )
    .setColor(RARITY_COLOR[commander.rarity] ?? 0x1B5E20)
    .setFooter({ text: "Powered by Scryfall · /synergy" });

  if (cmdrImage) embed.setThumbnail(cmdrImage);

  for (const { card, reason } of picks) {
    const face     = card.card_faces?.[0] ?? card;
    const manaCost = (face.mana_cost ?? card.mana_cost ?? "")
      .replace(/\{/g, "").replace(/\}/g, " ").trim();
    const type     = face.type_line ?? card.type_line ?? "";
    const oracle   = face.oracle_text ?? card.oracle_text ?? "";
    const snippet  = oracle.split("\n")[0].slice(0, 80) + (oracle.length > 80 ? "…" : "");
    const price    = card.prices?.usd ? `$${card.prices.usd}` : "";

    embed.addFields({
      name:  `🃏 ${card.name}${manaCost ? ` · ${manaCost}` : ""}${price ? `  (${price})` : ""}`,
      value: `*${type}*\n${snippet}\n✨ ${reason}`,
      inline: false,
    });
  }
  return embed;
}

function buildPaginationRow(sessionKey, page, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`prev|${sessionKey}`)
      .setLabel("◀ Previous")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(`next|${sessionKey}`)
      .setLabel("Next ▶")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page === totalPages - 1),
  );
}

// ══════════════════════════════════════════════════════════════
//  /stndmeta — STANDARD METAGAME (MTGGoldfish)
// ══════════════════════════════════════════════════════════════

// Medal emojis for ranks 1–5
const MEDALS = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"];

// ─── Embed accent colors per format ───────────────────────────
const META_COLOR    = 0xE8A838; // gold   — Standard
const CEDH_COLOR    = 0x6A0DAD; // purple — cEDH
const MODERN_COLOR  = 0x1565C0; // blue   — Modern
const PIONEER_COLOR = 0xD32F2F; // red    — Pioneer
const PAUPER_COLOR  = 0x558B2F; // olive  — Pauper
const LEGACY_COLOR  = 0x5D4037; // bronze — Legacy
const VINTAGE_COLOR = 0x455A64; // slate  — Vintage

const MTGTOP8 = "https://www.mtgtop8.com";

// Shared browser-like headers to avoid bot blocks
const SCRAPE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/124.0.0.0 Safari/537.36",
  "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

/**
 * Builds a visual percentage bar  ████░░░░  (10 blocks wide).
 * Scale: 25% of meta = full bar.
 */
function metaBar(shareStr) {
  const pct = parseFloat(shareStr);
  if (isNaN(pct)) return "";
  const filled = Math.round(Math.min(pct / 25, 1) * 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

/**
 * Core scraper for MTGTop8 metagame pages.
 *
 * MTGTop8 format codes:
 *   ST  = Standard
 *   MO  = Modern
 *   EDH = Commander / cEDH
 *
 * The metagame breakdown table rows have class "hover_tr".
 * Each row contains: [deck name link] [% share] [# events] [# decks]
 */
async function fetchMTGTop8Meta(formatCode, limit = 5) {
  // Date filter: rolling ~90 days using dd/mm/yy
  const now   = new Date();
  const since = new Date(now - 90 * 24 * 60 * 60 * 1000);
  const pad   = n => String(n).padStart(2, "0");
  const fmtTop8Date = d =>
    `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`;

  const url = `${MTGTOP8}/format?f=${formatCode}&date_start=${fmtTop8Date(since)}&date_end=${fmtTop8Date(now)}`;

  const res = await safeFetch(url, { headers: SCRAPE_HEADERS });
  if (!res.ok) throw new Error(`MTGTop8 returned HTTP ${res.status}`);

  const html = await safeText(res);
  const $    = cheerio.load(html);
  const decks = [];

  // MTGTop8 meta breakdown: rows with class "hover_tr" inside the meta table.
  // Each row: <td> deck link </td> <td> XX% </td> <td> events </td> <td> decks </td>
  $("tr.hover_tr").each((_, row) => {
    if (decks.length >= limit) return false;

    const cells   = $(row).find("td");
    if (cells.length < 2) return;

    const anchor  = $(cells[0]).find("a").first();
    const name    = anchor.text().trim();
    const deckUrl = safeMTGTop8Url(anchor.attr("href"));

    // Second cell is the percentage (e.g. "14%")
    const shareTxt = $(cells[1]).text().trim().replace(/[^0-9.%]/g, "");
    const share    = shareTxt || "N/A";

    if (name) decks.push({ name, deckUrl, share });
  });

  // Fallback: MTGTop8 sometimes uses a different row class or table structure.
  // Try td.G14 links if hover_tr yielded nothing.
  if (decks.length === 0) {
    $("td.G14 a, td.S14 a").each((_, anchor) => {
      if (decks.length >= limit) return false;

      const name    = $(anchor).text().trim();
      const deckUrl = safeMTGTop8Url($(anchor).attr("href"));

      // Grab the sibling td for percentage
      const pctCell  = $(anchor).closest("tr").find("td").eq(1);
      const shareTxt = pctCell.text().trim().replace(/[^0-9.%]/g, "");
      const share    = shareTxt || "N/A";

      if (name) decks.push({ name, deckUrl, share });
    });
  }

  return { decks, since, now };
}

// ══════════════════════════════════════════════════════════════
//  /stndmeta — STANDARD METAGAME
// ══════════════════════════════════════════════════════════════

async function fetchStandardMeta(limit = 5) {
  return fetchMTGTop8Meta("ST", limit);
}

function buildMetaEmbed({ decks, since, now }) {
  const fmtDate = d => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const embed = new EmbedBuilder()
    .setTitle("🏆 Standard Metagame — Top 5 Decks")
    .setDescription(
      `Data sourced from **[MTGTop8](${MTGTOP8}/format?f=ST)**\n` +
      `📅 Last 90 days: ${fmtDate(since)} → ${fmtDate(now)}`
    )
    .setColor(META_COLOR)
    .setThumbnail("https://www.mtgtop8.com/graph/favicon.png")
    .setFooter({ text: "MTGTop8 Standard Metagame · /stndmeta" })
    .setTimestamp();

  if (decks.length === 0) {
    embed.addFields({ name: "No data found", value: "MTGTop8 may be temporarily unavailable. Try again shortly or visit the site directly.", inline: false });
    return embed;
  }

  for (let i = 0; i < decks.length; i++) {
    const { name, deckUrl, share } = decks[i];
    const bar = metaBar(share);
    embed.addFields({
      name:  `${MEDALS[i]}  ${name}`,
      value: [
        bar ? `\`${bar}\`  **${share}** of meta` : `**Meta Share:** ${share}`,
        `🔗 [View on MTGTop8](${deckUrl})`,
      ].join("\n"),
      inline: false,
    });
  }
  return embed;
}

// ══════════════════════════════════════════════════════════════
//  /cmdrmeta — cEDH COMMANDER METAGAME
// ══════════════════════════════════════════════════════════════

async function fetchCEDHMeta(limit = 5) {
  return fetchMTGTop8Meta("EDH", limit);
}

function buildCEDHMetaEmbed({ decks, since, now }) {
  const fmtDate = d => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const embed = new EmbedBuilder()
    .setTitle("👑 cEDH Commander Metagame — Top 5 Decks")
    .setDescription(
      `Data sourced from **[MTGTop8](${MTGTOP8}/format?f=EDH)**\n` +
      `📅 Last 90 days: ${fmtDate(since)} → ${fmtDate(now)}\n` +
      `*cEDH = Competitive EDH — optimised for maximum power & speed*`
    )
    .setColor(CEDH_COLOR)
    .setThumbnail("https://www.mtgtop8.com/graph/favicon.png")
    .setFooter({ text: "MTGTop8 cEDH Metagame · /cmdrmeta" })
    .setTimestamp();

  if (decks.length === 0) {
    embed.addFields({ name: "No data found", value: "MTGTop8 may be temporarily unavailable. Try again shortly or visit the site directly.", inline: false });
    return embed;
  }

  for (let i = 0; i < decks.length; i++) {
    const { name, deckUrl, share } = decks[i];
    const bar = metaBar(share);
    embed.addFields({
      name:  `${MEDALS[i]}  ${name}`,
      value: [
        bar ? `\`${bar}\`  **${share}** of meta` : `**Meta Share:** ${share}`,
        `🔗 [View on MTGTop8](${deckUrl})`,
      ].join("\n"),
      inline: false,
    });
  }
  return embed;
}

// ══════════════════════════════════════════════════════════════
//  /mdrnmeta — MODERN METAGAME
// ══════════════════════════════════════════════════════════════

async function fetchModernMeta(limit = 5) {
  return fetchMTGTop8Meta("MO", limit);
}

function buildModernMetaEmbed({ decks, since, now }) {
  const fmtDate = d => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const embed = new EmbedBuilder()
    .setTitle("⚡ Modern Metagame — Top 5 Decks")
    .setDescription(
      `Data sourced from **[MTGTop8](${MTGTOP8}/format?f=MO)**\n` +
      `📅 Last 90 days: ${fmtDate(since)} → ${fmtDate(now)}`
    )
    .setColor(MODERN_COLOR)
    .setThumbnail("https://www.mtgtop8.com/graph/favicon.png")
    .setFooter({ text: "MTGTop8 Modern Metagame · /mdrnmeta" })
    .setTimestamp();

  if (decks.length === 0) {
    embed.addFields({ name: "No data found", value: "MTGTop8 may be temporarily unavailable. Try again shortly or visit the site directly.", inline: false });
    return embed;
  }

  for (let i = 0; i < decks.length; i++) {
    const { name, deckUrl, share } = decks[i];
    const bar = metaBar(share);
    embed.addFields({
      name:  `${MEDALS[i]}  ${name}`,
      value: [
        bar ? `\`${bar}\`  **${share}** of meta` : `**Meta Share:** ${share}`,
        `🔗 [View on MTGTop8](${deckUrl})`,
      ].join("\n"),
      inline: false,
    });
  }
  return embed;
}

// ══════════════════════════════════════════════════════════════
//  /pioneer — PIONEER METAGAME
// ══════════════════════════════════════════════════════════════

async function fetchPioneerMeta(limit = 5) {
  return fetchMTGTop8Meta("PI", limit);
}

function buildPioneerMetaEmbed({ decks, since, now }) {
  const fmtDate = d => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const embed = new EmbedBuilder()
    .setTitle("🚀 Pioneer Metagame — Top 5 Decks")
    .setDescription(
      `Data sourced from **[MTGTop8](${MTGTOP8}/format?f=PI)**\n` +
      `📅 Last 90 days: ${fmtDate(since)} → ${fmtDate(now)}`
    )
    .setColor(PIONEER_COLOR)
    .setThumbnail("https://www.mtgtop8.com/graph/favicon.png")
    .setFooter({ text: "MTGTop8 Pioneer Metagame · /pioneer" })
    .setTimestamp();

  if (decks.length === 0) {
    embed.addFields({ name: "No data found", value: "MTGTop8 may be temporarily unavailable. Try again shortly or visit the site directly.", inline: false });
    return embed;
  }

  for (let i = 0; i < decks.length; i++) {
    const { name, deckUrl, share } = decks[i];
    const bar = metaBar(share);
    embed.addFields({
      name:  `${MEDALS[i]}  ${name}`,
      value: [
        bar ? `\`${bar}\`  **${share}** of meta` : `**Meta Share:** ${share}`,
        `🔗 [View on MTGTop8](${deckUrl})`,
      ].join("\n"),
      inline: false,
    });
  }
  return embed;
}

// ══════════════════════════════════════════════════════════════
//  /pauper — PAUPER METAGAME
// ══════════════════════════════════════════════════════════════

async function fetchPauperMeta(limit = 5) {
  return fetchMTGTop8Meta("PAU", limit);
}

function buildPauperMetaEmbed({ decks, since, now }) {
  const fmtDate = d => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const embed = new EmbedBuilder()
    .setTitle("🪙 Pauper Metagame — Top 5 Decks")
    .setDescription(
      `Data sourced from **[MTGTop8](${MTGTOP8}/format?f=PAU)**\n` +
      `📅 Last 90 days: ${fmtDate(since)} → ${fmtDate(now)}\n` +
      `*Pauper = commons-only format*`
    )
    .setColor(PAUPER_COLOR)
    .setThumbnail("https://www.mtgtop8.com/graph/favicon.png")
    .setFooter({ text: "MTGTop8 Pauper Metagame · /pauper" })
    .setTimestamp();

  if (decks.length === 0) {
    embed.addFields({ name: "No data found", value: "MTGTop8 may be temporarily unavailable. Try again shortly or visit the site directly.", inline: false });
    return embed;
  }

  for (let i = 0; i < decks.length; i++) {
    const { name, deckUrl, share } = decks[i];
    const bar = metaBar(share);
    embed.addFields({
      name:  `${MEDALS[i]}  ${name}`,
      value: [
        bar ? `\`${bar}\`  **${share}** of meta` : `**Meta Share:** ${share}`,
        `🔗 [View on MTGTop8](${deckUrl})`,
      ].join("\n"),
      inline: false,
    });
  }
  return embed;
}

// ══════════════════════════════════════════════════════════════
//  /legacy — LEGACY METAGAME
// ══════════════════════════════════════════════════════════════

async function fetchLegacyMeta(limit = 5) {
  return fetchMTGTop8Meta("LE", limit);
}

function buildLegacyMetaEmbed({ decks, since, now }) {
  const fmtDate = d => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const embed = new EmbedBuilder()
    .setTitle("🏛️ Legacy Metagame — Top 5 Decks")
    .setDescription(
      `Data sourced from **[MTGTop8](${MTGTOP8}/format?f=LE)**\n` +
      `📅 Last 90 days: ${fmtDate(since)} → ${fmtDate(now)}`
    )
    .setColor(LEGACY_COLOR)
    .setThumbnail("https://www.mtgtop8.com/graph/favicon.png")
    .setFooter({ text: "MTGTop8 Legacy Metagame · /legacy" })
    .setTimestamp();

  if (decks.length === 0) {
    embed.addFields({ name: "No data found", value: "MTGTop8 may be temporarily unavailable. Try again shortly or visit the site directly.", inline: false });
    return embed;
  }

  for (let i = 0; i < decks.length; i++) {
    const { name, deckUrl, share } = decks[i];
    const bar = metaBar(share);
    embed.addFields({
      name:  `${MEDALS[i]}  ${name}`,
      value: [
        bar ? `\`${bar}\`  **${share}** of meta` : `**Meta Share:** ${share}`,
        `🔗 [View on MTGTop8](${deckUrl})`,
      ].join("\n"),
      inline: false,
    });
  }
  return embed;
}

// ══════════════════════════════════════════════════════════════
//  /vintage — VINTAGE METAGAME
// ══════════════════════════════════════════════════════════════

async function fetchVintageMeta(limit = 5) {
  return fetchMTGTop8Meta("VI", limit);
}

function buildVintageMetaEmbed({ decks, since, now }) {
  const fmtDate = d => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const embed = new EmbedBuilder()
    .setTitle("💎 Vintage Metagame — Top 5 Decks")
    .setDescription(
      `Data sourced from **[MTGTop8](${MTGTOP8}/format?f=VI)**\n` +
      `📅 Last 90 days: ${fmtDate(since)} → ${fmtDate(now)}`
    )
    .setColor(VINTAGE_COLOR)
    .setThumbnail("https://www.mtgtop8.com/graph/favicon.png")
    .setFooter({ text: "MTGTop8 Vintage Metagame · /vintage" })
    .setTimestamp();

  if (decks.length === 0) {
    embed.addFields({ name: "No data found", value: "MTGTop8 may be temporarily unavailable. Try again shortly or visit the site directly.", inline: false });
    return embed;
  }

  for (let i = 0; i < decks.length; i++) {
    const { name, deckUrl, share } = decks[i];
    const bar = metaBar(share);
    embed.addFields({
      name:  `${MEDALS[i]}  ${name}`,
      value: [
        bar ? `\`${bar}\`  **${share}** of meta` : `**Meta Share:** ${share}`,
        `🔗 [View on MTGTop8](${deckUrl})`,
      ].join("\n"),
      inline: false,
    });
  }
  return embed;
}

// ══════════════════════════════════════════════════════════════
//  /upcomingsets — UPCOMING SET RELEASE DATES (Scryfall)
// ══════════════════════════════════════════════════════════════

const RELEVANT_SET_TYPES = new Set([
  "core", "expansion", "masters", "draft_innovation",
  "commander", "funny", "starter", "box", "premium_deck",
  "duel_deck", "from_the_vault", "spellbook", "arsenal",
  "planechase", "archenemy", "masterpiece",
]);

const SET_TYPE_LABEL = {
  core:            "Core Set",
  expansion:       "Expansion",
  masters:         "Masters",
  draft_innovation:"Draft Innovation",
  commander:       "Commander",
  funny:           "Un-Set / Parody",
  starter:         "Starter Kit",
  box:             "Box Set",
  premium_deck:    "Premium Deck",
  duel_deck:       "Duel Deck",
  from_the_vault:  "From the Vault",
  spellbook:       "Spellbook",
  arsenal:         "Arsenal",
  planechase:      "Planechase",
  archenemy:       "Archenemy",
  masterpiece:     "Masterpiece Series",
};

// Days until release → urgency emoji
function releaseEmoji(daysUntil) {
  if (daysUntil <= 7)  return "🔥"; // dropping very soon
  if (daysUntil <= 30) return "📅"; // within a month
  if (daysUntil <= 90) return "🗓️"; // within a quarter
  return "🔮";
}

async function fetchUpcomingSets() {
  const data = await scryfallFetch(`${SCRYFALL}/sets`);
  if (!data?.data) throw new Error("Scryfall /sets returned no data");

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return data.data
    .filter(s => {
      if (!s.released_at) return false;
      if (!RELEVANT_SET_TYPES.has(s.set_type)) return false;
      const releaseDate = new Date(s.released_at);
      return releaseDate >= today;
    })
    .sort((a, b) => new Date(a.released_at) - new Date(b.released_at))
    .slice(0, 10); // up to 10 upcoming sets
}

function buildUpcomingSetsEmbed(sets) {
  const embed = new EmbedBuilder()
    .setTitle("📦 Upcoming MTG Set Releases")
    .setDescription(
      `Data sourced from **[Scryfall](https://scryfall.com/sets)**\n` +
      `Showing the next **${sets.length}** upcoming set${sets.length !== 1 ? "s" : ""} — all dates are official release dates.`
    )
    .setColor(0x00BCD4) // teal
    .setFooter({ text: "Scryfall Set Data · /upcomingsets" })
    .setTimestamp();

  if (sets.length === 0) {
    embed.addFields({
      name:  "No upcoming sets found",
      value: "Scryfall doesn't have any future sets listed right now. Check back soon!",
      inline: false,
    });
    return embed;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const s of sets) {
    const releaseDate = new Date(s.released_at);
    const daysUntil   = Math.round((releaseDate - today) / (1000 * 60 * 60 * 24));
    const emoji       = releaseEmoji(daysUntil);
    const typeLabel   = SET_TYPE_LABEL[s.set_type] ?? s.set_type;
    const cardCount   = s.card_count ? `${s.card_count} cards` : "card count TBD";
    const daysLabel   = daysUntil === 0
      ? "**Releases TODAY!** 🎉"
      : daysUntil === 1
        ? "**Releases TOMORROW!**"
        : `**${daysUntil} days** away`;

    const scryfallUrl = s.scryfall_uri ?? `https://scryfall.com/sets/${s.code}`;

    embed.addFields({
      name:  `${emoji}  ${s.name}  \`${(s.code ?? "").toUpperCase()}\``,
      value: [
        `📆 **${releaseDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}** — ${daysLabel}`,
        `🏷️ ${typeLabel}  ·  ${cardCount}`,
        `🔗 [View on Scryfall](${scryfallUrl})`,
      ].join("\n"),
      inline: false,
    });
  }

  return embed;
}

// ══════════════════════════════════════════════════════════════
//  /combo — COMMANDER SPELLBOOK COMBO LOOKUP
// ══════════════════════════════════════════════════════════════

const SPELLBOOK_API   = "https://backend.commanderspellbook.com";
const SPELLBOOK_SITE  = "https://commanderspellbook.com";
const COMBO_COLOR     = 0xE91E63; // magenta
const COMBO_PAGE_SIZE = 3;        // combos are verbose — fewer per page

async function fetchCombos(cardName, limit = 15) {
  const query = encodeURIComponent(`card:"${cardName}"`);
  const url   = `${SPELLBOOK_API}/variants/?q=${query}&ordering=-popularity&limit=${limit}`;
  const res   = await safeFetch(url, { headers: { "Accept": "application/json" } });
  if (!res.ok) return [];
  const data = await safeJson(res);
  return data?.results ?? [];
}

// API shape varies slightly; extract defensively.
function comboCardName(u)   { return u?.card?.name ?? u?.name ?? null; }
function comboFeatureName(f) { return f?.feature?.name ?? f?.name ?? null; }

function buildComboEmbed(cardName, combos, page, totalPages) {
  const embed = new EmbedBuilder()
    .setTitle(`✨ Combos featuring ${cardName}`)
    .setColor(COMBO_COLOR)
    .setDescription(
      `Showing **${combos.length}** combo${combos.length !== 1 ? "s" : ""} on this page ` +
      `— page **${page + 1}** of **${totalPages}**\n` +
      `Data from **[Commander Spellbook](${SPELLBOOK_SITE})**`
    )
    .setFooter({ text: "Commander Spellbook · /combo" });

  for (const combo of combos) {
    const id       = typeof combo.id === "string" ? combo.id : String(combo.id ?? "");
    const comboUrl = id ? `${SPELLBOOK_SITE}/combo/${encodeURIComponent(id)}/` : SPELLBOOK_SITE;
    const uses     = (combo.uses ?? []).map(comboCardName).filter(Boolean);
    const produces = (combo.produces ?? []).map(comboFeatureName).filter(Boolean);
    const identity = combo.identity || "C";

    const piecesList  = uses.length     ? uses.map(n => `• ${n}`).join("\n")       : "—";
    const resultsList = produces.length ? produces.map(p => `🎯 ${p}`).join("\n") : "—";

    const mana = combo.mana_needed
      ? `\n**Mana:** ${combo.mana_needed.replace(/\{/g, "").replace(/\}/g, " ").trim()}`
      : "";

    const headline = produces[0] ?? "Combo";
    const title    = headline.length > 80 ? headline.slice(0, 77) + "…" : headline;

    let body = `**Pieces (${uses.length}):**\n${piecesList}\n\n**Result:**\n${resultsList}${mana}\n🔗 [View combo](${comboUrl})`;
    if (body.length > 1024) body = body.slice(0, 1020) + "…";

    embed.addFields({
      name:  `🔮 ${title}  ·  [${identity}]`,
      value: body,
      inline: false,
    });
  }
  return embed;
}

// ══════════════════════════════════════════════════════════════
//  /rulings — SCRYFALL CARD RULINGS
// ══════════════════════════════════════════════════════════════

const RULING_SOURCE_LABEL = {
  wotc:     "Wizards of the Coast",
  scryfall: "Scryfall",
};

async function fetchRulings(cardId) {
  const data = await scryfallFetch(`${SCRYFALL}/cards/${encodeURIComponent(cardId)}/rulings`);
  return data?.data ?? [];
}

function buildRulingsEmbed(card, rulings, page, totalPages) {
  const face  = card.card_faces?.[0] ?? card;
  const image = face.image_uris?.art_crop ?? card.image_uris?.art_crop ?? null;

  const embed = new EmbedBuilder()
    .setTitle(`📖 Rulings: ${card.name}`)
    .setURL(card.scryfall_uri ?? "")
    .setColor(RARITY_COLOR[card.rarity] ?? 0x607D8B)
    .setDescription(
      `**${face.type_line ?? card.type_line ?? ""}**\n` +
      `Showing **${rulings.length}** ruling${rulings.length !== 1 ? "s" : ""} on this page ` +
      `— page **${page + 1}** of **${totalPages}**\n` +
      `Data from **[Scryfall](https://scryfall.com)**`
    )
    .setFooter({ text: "Scryfall Rulings · /rulings" });

  if (image) embed.setThumbnail(image);

  for (const r of rulings) {
    const date   = r.published_at ?? "unknown date";
    const source = RULING_SOURCE_LABEL[r.source] ?? (r.source ?? "Unknown");
    let comment  = (r.comment ?? "").trim();
    if (!comment) comment = "—";
    if (comment.length > 1000) comment = comment.slice(0, 997) + "…";

    embed.addFields({
      name:  `📅 ${date}  ·  ${source}`,
      value: comment,
      inline: false,
    });
  }
  return embed;
}

// ══════════════════════════════════════════════════════════════
//  /spoilers — LATEST PREVIEWED CARDS (Scryfall)
// ══════════════════════════════════════════════════════════════

const SPOILERS_COLOR = 0xFF9800; // amber

// Finds the next upcoming set from Scryfall, or a specific set by code.
async function findSpoilerSet(setCode = null) {
  const data = await scryfallFetch(`${SCRYFALL}/sets`);
  if (!data?.data) return null;

  if (setCode) {
    const normalized = setCode.toLowerCase();
    return data.data.find(s => (s.code ?? "").toLowerCase() === normalized) ?? null;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const upcoming = data.data
    .filter(s => {
      if (!s.released_at) return false;
      if (!RELEVANT_SET_TYPES.has(s.set_type)) return false;
      return new Date(s.released_at) >= today;
    })
    .sort((a, b) => new Date(a.released_at) - new Date(b.released_at));

  return upcoming[0] ?? null;
}

async function fetchSpoilers(setCode, limit = 15) {
  const url = `${SCRYFALL}/cards/search?q=${encodeURIComponent(`set:${setCode}`)}&order=spoiled&dir=desc&unique=cards`;
  const data = await scryfallFetch(url);
  if (!data?.data) return [];
  return data.data.slice(0, limit);
}

function buildSpoilersEmbed(setInfo, cards, page, totalPages) {
  const setName     = setInfo.name ?? "Unknown Set";
  const setCode     = (setInfo.code ?? "").toUpperCase();
  const releaseDate = setInfo.released_at ? new Date(setInfo.released_at) : null;

  const descLines = [];
  if (releaseDate) {
    descLines.push(
      `📆 Release: **${releaseDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}**`
    );
  }
  descLines.push(
    `Showing **${cards.length}** recently spoiled card${cards.length !== 1 ? "s" : ""} ` +
    `— page **${page + 1}** of **${totalPages}**`
  );
  descLines.push(`Data from **[Scryfall](${setInfo.scryfall_uri ?? "https://scryfall.com"})**`);

  const embed = new EmbedBuilder()
    .setTitle(`🆕 Latest Spoilers — ${setName} \`${setCode}\``)
    .setColor(SPOILERS_COLOR)
    .setDescription(descLines.join("\n"))
    .setFooter({ text: "Scryfall · /spoilers" });

  // Use first card's art as the thumbnail for visual interest.
  const firstCard = cards[0];
  if (firstCard) {
    const face  = firstCard.card_faces?.[0] ?? firstCard;
    const image = face.image_uris?.art_crop ?? firstCard.image_uris?.art_crop ?? null;
    if (image) embed.setThumbnail(image);
  }

  for (const card of cards) {
    const face     = card.card_faces?.[0] ?? card;
    const manaCost = (face.mana_cost ?? card.mana_cost ?? "")
      .replace(/\{/g, "").replace(/\}/g, " ").trim();
    const type    = face.type_line ?? card.type_line ?? "";
    const oracle  = face.oracle_text ?? card.oracle_text ?? "";
    const snippet = oracle.split("\n")[0].slice(0, 100) + (oracle.length > 100 ? "…" : "");

    const preview       = card.preview ?? {};
    const previewDate   = preview.previewed_at ?? "unknown date";
    const previewSource = preview.source ?? "";
    const scryfallUrl   = card.scryfall_uri ?? "";

    const lines = [
      type ? `*${type}*` : "",
      snippet || "(no text yet)",
      `📅 Spoiled: ${previewDate}${previewSource ? ` · ${previewSource}` : ""}`,
      scryfallUrl ? `🔗 [View on Scryfall](${scryfallUrl})` : "",
    ].filter(Boolean);

    let body = lines.join("\n");
    if (body.length > 1024) body = body.slice(0, 1020) + "…";

    embed.addFields({
      name:  `🃏 ${card.name}${manaCost ? ` · ${manaCost}` : ""}`,
      value: body,
      inline: false,
    });
  }
  return embed;
}


const client   = new Client({ intents: [GatewayIntentBits.Guilds] });
const sessions = new Map(); // synergy pagination state

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  client.user.setActivity("/get · /synergy · /stndmeta · /cmdrmeta · /mdrnmeta · /pioneer · /pauper · /legacy · /vintage · /upcomingsets · /combo · /rulings · /spoilers", { type: 3 });
});

client.on("interactionCreate", async interaction => {

  // ── Autocomplete for card/commander name inputs ──
  // Fires on every keystroke; Discord allows 3s to respond.
  // LRU-cached Scryfall lookups keep this cheap.
  if (interaction.isAutocomplete()) {
    const focused = interaction.options.getFocused(true);
    const AUTOCOMPLETE_OPTS = new Set(["card", "commander"]);

    if (!AUTOCOMPLETE_OPTS.has(focused.name)) {
      try { await interaction.respond([]); } catch {}
      return;
    }

    const query = (focused.value ?? "").trim();
    if (query.length < 2) {
      try { await interaction.respond([]); } catch {}
      return;
    }

    try {
      const suggestions = await scryfallAutocomplete(query);
      const choices = suggestions.slice(0, 25).map(name => {
        const trimmed = name.length > 100 ? name.slice(0, 100) : name;
        return { name: trimmed, value: trimmed };
      });
      await interaction.respond(choices);
    } catch (err) {
      console.error("autocomplete error:", err);
      try { await interaction.respond([]); } catch {}
    }
    return;
  }

  if (interaction.isChatInputCommand() || interaction.isMessageContextMenuCommand()) {
    const wait = checkCooldown(interaction.user.id, interaction.commandName);
    if (wait > 0) {
      const invoker = interaction.isMessageContextMenuCommand()
        ? `**${interaction.commandName}**`
        : `\`/${interaction.commandName}\``;
      return interaction.reply({
        content: `⏳ Slow down! Please wait **${wait}s** before using ${invoker} again.`,
        ephemeral: true,
      });
    }
  }

  // ── Context menu: scan a message for [[card]] references ──
  if (interaction.isMessageContextMenuCommand() && interaction.commandName === "Lookup MTG Cards") {
    await interaction.deferReply();

    const content = interaction.targetMessage?.content ?? "";
    const matches = [...content.matchAll(/\[\[([^\[\]]+)\]\]/g)];

    if (matches.length === 0) {
      return interaction.editReply({
        content: "⚠️ No card names found. Use `[[card name]]` syntax to mark cards in the message.",
      });
    }

    // Dedupe, trim, cap at 5 to stay under Discord's per-message embed limits.
    const uniqueNames = [...new Set(matches.map(m => m[1].trim()))].filter(Boolean).slice(0, 5);

    const results = await Promise.all(
      uniqueNames.map(async n => ({ name: n, data: await fetchCard(n) }))
    );

    const embeds   = [];
    const notFound = [];
    for (const { name, data } of results) {
      if (data.error) notFound.push(name);
      else embeds.push(buildCardEmbed(data));
    }

    const notes = [];
    if (notFound.length) notes.push(`⚠️ Not found: ${notFound.map(n => `\`${n}\``).join(", ")}`);
    if (matches.length > uniqueNames.length) {
      notes.push(`ℹ️ Found ${matches.length} references; showing first ${uniqueNames.length} unique cards.`);
    }

    if (embeds.length === 0) {
      return interaction.editReply({ content: notes.join("\n") || "⚠️ No valid card names found." });
    }

    return interaction.editReply({
      content: notes.length ? notes.join("\n") : null,
      embeds,
    });
  }

  if (interaction.isChatInputCommand() && interaction.commandName === "get") {
    await interaction.deferReply();

    const cardName = interaction.options.getString("card");
    const setCode  = interaction.options.getString("set");
    const card     = await fetchCard(cardName, setCode);

    if (card.error) return interaction.editReply({ content: `⚠️ ${card.error}` });
    return interaction.editReply({ embeds: [buildCardEmbed(card)] });
  }

  if (interaction.isChatInputCommand() && interaction.commandName === "synergy") {
    await interaction.deferReply();

    const commanderName = interaction.options.getString("commander");
    const maxResults    = interaction.options.getInteger("results") ?? 20;

    const commander = await scryfallFetch(
      `${SCRYFALL}/cards/named?fuzzy=${encodeURIComponent(commanderName)}`
    );

    if (!commander || commander.object === "error") {
      return interaction.editReply(
        `⚠️ Commander **"${commanderName}"** not found. Check the spelling and try again.`
      );
    }

    const typeLine = (commander.type_line ?? "").toLowerCase();
    if (!typeLine.includes("legendary") && !typeLine.includes("planeswalker")) {
      await interaction.followUp({
        content: `⚠️ **${commander.name}** doesn't appear to be a Legendary Creature or Planeswalker. Results may be less tailored.`,
        ephemeral: true,
      });
    }

    const picks = await fetchSynergyCards(commander, maxResults);
    if (picks.length === 0) {
      return interaction.editReply(
        `😕 No synergy cards found for **${commander.name}**. Try a different commander.`
      );
    }

    const totalPages = Math.ceil(picks.length / PAGE_SIZE);
    const sessionKey = interaction.id;
    sessions.set(sessionKey, { type: "synergy", picks, commander, page: 0, totalPages, pageSize: PAGE_SIZE });

    const pageSlice = picks.slice(0, PAGE_SIZE);
    const embed     = buildSynergyEmbed(commander, pageSlice, 0, totalPages);
    const row       = buildPaginationRow(sessionKey, 0, totalPages);

    return interaction.editReply({ embeds: [embed], components: totalPages > 1 ? [row] : [] });
  }

  if (interaction.isChatInputCommand() && interaction.commandName === "stndmeta") {
    await interaction.deferReply();

    try {
      const decks = await fetchStandardMeta(5);
      const embed = buildMetaEmbed(decks);
      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error("❌ /stndmeta error:", err);
      return interaction.editReply(
        "⚠️ Could not fetch metagame data from MTGGoldfish. The site may be temporarily unavailable — try again in a moment."
      );
    }
  }

  if (interaction.isChatInputCommand() && interaction.commandName === "cmdrmeta") {
    await interaction.deferReply();

    try {
      const decks = await fetchCEDHMeta(5);
      const embed = buildCEDHMetaEmbed(decks);
      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error("❌ /cmdrmeta error:", err);
      return interaction.editReply(
        "⚠️ Could not fetch cEDH metagame data from MTGGoldfish. The site may be temporarily unavailable — try again in a moment."
      );
    }
  }

  if (interaction.isChatInputCommand() && interaction.commandName === "mdrnmeta") {
    await interaction.deferReply();

    try {
      const decks = await fetchModernMeta(5);
      const embed = buildModernMetaEmbed(decks);
      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error("❌ /mdrnmeta error:", err);
      return interaction.editReply(
        "⚠️ Could not fetch Modern metagame data from MTGGoldfish. The site may be temporarily unavailable — try again in a moment."
      );
    }
  }

  if (interaction.isChatInputCommand() && interaction.commandName === "pioneer") {
    await interaction.deferReply();

    try {
      const decks = await fetchPioneerMeta(5);
      const embed = buildPioneerMetaEmbed(decks);
      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error("❌ /pioneer error:", err);
      return interaction.editReply(
        "⚠️ Could not fetch Pioneer metagame data from MTGTop8. The site may be temporarily unavailable — try again in a moment."
      );
    }
  }

  if (interaction.isChatInputCommand() && interaction.commandName === "pauper") {
    await interaction.deferReply();

    try {
      const decks = await fetchPauperMeta(5);
      const embed = buildPauperMetaEmbed(decks);
      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error("❌ /pauper error:", err);
      return interaction.editReply(
        "⚠️ Could not fetch Pauper metagame data from MTGTop8. The site may be temporarily unavailable — try again in a moment."
      );
    }
  }

  if (interaction.isChatInputCommand() && interaction.commandName === "legacy") {
    await interaction.deferReply();

    try {
      const decks = await fetchLegacyMeta(5);
      const embed = buildLegacyMetaEmbed(decks);
      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error("❌ /legacy error:", err);
      return interaction.editReply(
        "⚠️ Could not fetch Legacy metagame data from MTGTop8. The site may be temporarily unavailable — try again in a moment."
      );
    }
  }

  if (interaction.isChatInputCommand() && interaction.commandName === "vintage") {
    await interaction.deferReply();

    try {
      const decks = await fetchVintageMeta(5);
      const embed = buildVintageMetaEmbed(decks);
      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error("❌ /vintage error:", err);
      return interaction.editReply(
        "⚠️ Could not fetch Vintage metagame data from MTGTop8. The site may be temporarily unavailable — try again in a moment."
      );
    }
  }

  if (interaction.isChatInputCommand() && interaction.commandName === "upcomingsets") {
    await interaction.deferReply();

    try {
      const sets  = await fetchUpcomingSets();
      const embed = buildUpcomingSetsEmbed(sets);
      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error("❌ /upcomingsets error:", err);
      return interaction.editReply(
        "⚠️ Could not fetch set data from Scryfall. Try again in a moment."
      );
    }
  }

  if (interaction.isChatInputCommand() && interaction.commandName === "combo") {
    await interaction.deferReply();

    const cardName = interaction.options.getString("card");

    const card = await scryfallFetch(
      `${SCRYFALL}/cards/named?fuzzy=${encodeURIComponent(cardName)}`
    );
    if (!card || card.object === "error") {
      return interaction.editReply(
        `⚠️ Card **"${cardName}"** not found. Check the spelling and try again.`
      );
    }

    let combos;
    try {
      combos = await fetchCombos(card.name);
    } catch (err) {
      console.error("❌ /combo error:", err);
      return interaction.editReply(
        "⚠️ Could not fetch combo data from Commander Spellbook. Try again in a moment."
      );
    }

    if (combos.length === 0) {
      return interaction.editReply(
        `😕 No combos found featuring **${card.name}** on Commander Spellbook.`
      );
    }

    const totalPages = Math.ceil(combos.length / COMBO_PAGE_SIZE);
    const sessionKey = interaction.id;
    sessions.set(sessionKey, { type: "combo", combos, cardName: card.name, page: 0, totalPages, pageSize: COMBO_PAGE_SIZE });

    const pageSlice = combos.slice(0, COMBO_PAGE_SIZE);
    const embed     = buildComboEmbed(card.name, pageSlice, 0, totalPages);
    const row       = buildPaginationRow(sessionKey, 0, totalPages);

    return interaction.editReply({ embeds: [embed], components: totalPages > 1 ? [row] : [] });
  }

  if (interaction.isChatInputCommand() && interaction.commandName === "rulings") {
    await interaction.deferReply();

    const cardName = interaction.options.getString("card");

    const card = await scryfallFetch(
      `${SCRYFALL}/cards/named?fuzzy=${encodeURIComponent(cardName)}`
    );
    if (!card || card.object === "error" || !card.id) {
      return interaction.editReply(
        `⚠️ Card **"${cardName}"** not found. Check the spelling and try again.`
      );
    }

    let rulings;
    try {
      rulings = await fetchRulings(card.id);
    } catch (err) {
      console.error("❌ /rulings error:", err);
      return interaction.editReply(
        "⚠️ Could not fetch rulings from Scryfall. Try again in a moment."
      );
    }

    if (rulings.length === 0) {
      return interaction.editReply(
        `📭 No rulings have been published for **${card.name}**.`
      );
    }

    const totalPages = Math.ceil(rulings.length / PAGE_SIZE);
    const sessionKey = interaction.id;
    sessions.set(sessionKey, { type: "rulings", rulings, card, page: 0, totalPages, pageSize: PAGE_SIZE });

    const pageSlice = rulings.slice(0, PAGE_SIZE);
    const embed     = buildRulingsEmbed(card, pageSlice, 0, totalPages);
    const row       = buildPaginationRow(sessionKey, 0, totalPages);

    return interaction.editReply({ embeds: [embed], components: totalPages > 1 ? [row] : [] });
  }

  if (interaction.isChatInputCommand() && interaction.commandName === "spoilers") {
    await interaction.deferReply();

    const setCodeArg = interaction.options.getString("set");

    const setInfo = await findSpoilerSet(setCodeArg);
    if (!setInfo) {
      return interaction.editReply(
        setCodeArg
          ? `⚠️ Set **"${setCodeArg}"** not found on Scryfall.`
          : "⚠️ No upcoming sets found on Scryfall right now."
      );
    }

    let cards;
    try {
      cards = await fetchSpoilers(setInfo.code, 15);
    } catch (err) {
      console.error("❌ /spoilers error:", err);
      return interaction.editReply(
        "⚠️ Could not fetch spoilers from Scryfall. Try again in a moment."
      );
    }

    if (cards.length === 0) {
      return interaction.editReply(
        `📭 No spoilers have been published yet for **${setInfo.name}** (${(setInfo.code ?? "").toUpperCase()}).`
      );
    }

    const totalPages = Math.ceil(cards.length / PAGE_SIZE);
    const sessionKey = interaction.id;
    sessions.set(sessionKey, { type: "spoilers", cards, setInfo, page: 0, totalPages, pageSize: PAGE_SIZE });

    const pageSlice = cards.slice(0, PAGE_SIZE);
    const embed     = buildSpoilersEmbed(setInfo, pageSlice, 0, totalPages);
    const row       = buildPaginationRow(sessionKey, 0, totalPages);

    return interaction.editReply({ embeds: [embed], components: totalPages > 1 ? [row] : [] });
  }

  if (interaction.isButton()) {
    const [action, sessionKey] = interaction.customId.split("|");
    const session = sessions.get(sessionKey);

    if (!session) {
      return interaction.reply({
        content: "⏰ This session has expired. Run the command again.",
        ephemeral: true,
      });
    }

    if (action === "prev") session.page = Math.max(0, session.page - 1);
    if (action === "next") session.page = Math.min(session.totalPages - 1, session.page + 1);

    const { page, totalPages, pageSize } = session;
    const row = buildPaginationRow(sessionKey, page, totalPages);
    let embed;

    if (session.type === "combo") {
      const pageSlice = session.combos.slice(page * pageSize, (page + 1) * pageSize);
      embed = buildComboEmbed(session.cardName, pageSlice, page, totalPages);
    } else if (session.type === "rulings") {
      const pageSlice = session.rulings.slice(page * pageSize, (page + 1) * pageSize);
      embed = buildRulingsEmbed(session.card, pageSlice, page, totalPages);
    } else if (session.type === "spoilers") {
      const pageSlice = session.cards.slice(page * pageSize, (page + 1) * pageSize);
      embed = buildSpoilersEmbed(session.setInfo, pageSlice, page, totalPages);
    } else {
      const pageSlice = session.picks.slice(page * pageSize, (page + 1) * pageSize);
      embed = buildSynergyEmbed(session.commander, pageSlice, page, totalPages);
    }

    return interaction.update({ embeds: [embed], components: [row] });
  }
});


(async () => {
  await registerCommands();
  await client.login(TOKEN);
})();
