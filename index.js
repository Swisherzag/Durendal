// ============================================================
// MTG Discord Bot — Unified Entry Point
// Commands: /get  |  /synergy  |  /stndmeta  |  /cmdrmeta  |  /mdrnmeta  |  /upcomingsets
// Uses the Scryfall API + MTGGoldfish metagame data
// ============================================================
// Setup:
//   1. npm install
//   2. Fill in your credentials in .env
//   3. node index.js
// ============================================================

require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const { REST }    = require("@discordjs/rest");
const { Routes }  = require("discord-api-types/v10");
const cheerio     = require("cheerio");

// ─── Config (from .env) ────────────────────────────────────────
const TOKEN          = process.env.DISCORD_TOKEN;
const APPLICATION_ID = process.env.APPLICATION_ID;
const GUILD_ID       = process.env.GUILD_ID || "";

if (!TOKEN || !APPLICATION_ID) {
  console.error("❌ Missing DISCORD_TOKEN or APPLICATION_ID in .env");
  process.exit(1);
}

const SCRYFALL  = "https://api.scryfall.com";
const PAGE_SIZE = 5;

// ══════════════════════════════════════════════════════════════
//  SLASH COMMAND DEFINITIONS
// ══════════════════════════════════════════════════════════════

const commands = [
  // /get
  new SlashCommandBuilder()
    .setName("get")
    .setDescription("Look up a Magic: The Gathering card")
    .addStringOption(opt =>
      opt.setName("card")
         .setDescription("Card name (partial names work too!)")
         .setRequired(true)
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

  // /upcomingsets
  new SlashCommandBuilder()
    .setName("upcomingsets")
    .setDescription("Show upcoming MTG set release dates (via Scryfall)")
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
    console.log(`✅ /get, /synergy, /stndmeta, /cmdrmeta, /mdrnmeta, /upcomingsets registered ${GUILD_ID ? `to guild ${GUILD_ID}` : "globally"}.`);
  } catch (err) {
    console.error("❌ Failed to register commands:", err);
    process.exit(1);
  }
}

// ══════════════════════════════════════════════════════════════
//  SHARED SCRYFALL HELPERS
// ══════════════════════════════════════════════════════════════

async function scryfallFetch(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

async function scryfallSearch(query, n = 10) {
  const url  = `${SCRYFALL}/cards/search?q=${encodeURIComponent(query)}&order=edhrec&unique=cards`;
  const data = await scryfallFetch(url);
  if (!data?.data) return [];
  return data.data.slice(0, n);
}

// ─── Rarity → embed color ─────────────────────────────────────
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

  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) {
      const searchRes = await fetch(
        `${SCRYFALL}/cards/search?q=${encodeURIComponent(name)}&order=name&limit=5`
      );
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        const suggestions = searchData.data.map(c => `\`${c.name}\``).join(", ");
        return { error: `Card not found. Did you mean: ${suggestions}?` };
      }
      return { error: `No card found matching **"${name}"**.` };
    }
    return { error: `Scryfall API error: ${res.status}` };
  }
  return res.json();
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
const META_COLOR   = 0xE8A838; // gold   — Standard
const CEDH_COLOR   = 0x6A0DAD; // purple — cEDH
const MODERN_COLOR = 0x1565C0; // blue   — Modern

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

  const res = await fetch(url, { headers: SCRAPE_HEADERS });
  if (!res.ok) throw new Error(`MTGTop8 returned HTTP ${res.status}`);

  const html = await res.text();
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
    const href    = anchor.attr("href") ?? "";
    const deckUrl = href ? `${MTGTOP8}/${href}` : MTGTOP8;

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
      const href    = $(anchor).attr("href") ?? "";
      const deckUrl = href ? `${MTGTOP8}/${href}` : MTGTOP8;

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
//  /upcomingsets — UPCOMING SET RELEASE DATES (Scryfall)
// ══════════════════════════════════════════════════════════════

// Set types to show — excludes tokens, memorabilia, promo-only oddities
const RELEVANT_SET_TYPES = new Set([
  "core", "expansion", "masters", "draft_innovation",
  "commander", "funny", "starter", "box", "premium_deck",
  "duel_deck", "from_the_vault", "spellbook", "arsenal",
  "planechase", "archenemy", "masterpiece",
]);

// Map set type codes to friendly labels
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
  return "🔮";                       // far out
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
//  DISCORD CLIENT
// ══════════════════════════════════════════════════════════════

const client   = new Client({ intents: [GatewayIntentBits.Guilds] });
const sessions = new Map(); // synergy pagination state

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  client.user.setActivity("/get · /synergy · /stndmeta · /cmdrmeta · /mdrnmeta · /upcomingsets", { type: 3 });
});

client.on("interactionCreate", async interaction => {

  // ── /get ─────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === "get") {
    await interaction.deferReply();

    const cardName = interaction.options.getString("card");
    const setCode  = interaction.options.getString("set");
    const card     = await fetchCard(cardName, setCode);

    if (card.error) return interaction.editReply({ content: `⚠️ ${card.error}` });
    return interaction.editReply({ embeds: [buildCardEmbed(card)] });
  }

  // ── /synergy ─────────────────────────────────────────────────
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
    sessions.set(sessionKey, { picks, commander, page: 0, totalPages });

    const pageSlice = picks.slice(0, PAGE_SIZE);
    const embed     = buildSynergyEmbed(commander, pageSlice, 0, totalPages);
    const row       = buildPaginationRow(sessionKey, 0, totalPages);

    return interaction.editReply({ embeds: [embed], components: totalPages > 1 ? [row] : [] });
  }

  // ── /stndmeta ────────────────────────────────────────────────
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

  // ── /cmdrmeta ────────────────────────────────────────────────
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

  // ── /mdrnmeta ────────────────────────────────────────────────
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

  // ── /upcomingsets ────────────────────────────────────────────
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

  // ── Pagination buttons (/synergy) ────────────────────────────
  if (interaction.isButton()) {
    const [action, sessionKey] = interaction.customId.split("|");
    const session = sessions.get(sessionKey);

    if (!session) {
      return interaction.reply({
        content: "⏰ This session has expired. Run `/synergy` again.",
        ephemeral: true,
      });
    }

    if (action === "prev") session.page = Math.max(0, session.page - 1);
    if (action === "next") session.page = Math.min(session.totalPages - 1, session.page + 1);

    const { picks, commander, page, totalPages } = session;
    const pageSlice = picks.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const embed     = buildSynergyEmbed(commander, pageSlice, page, totalPages);
    const row       = buildPaginationRow(sessionKey, page, totalPages);

    return interaction.update({ embeds: [embed], components: [row] });
  }
});

// ══════════════════════════════════════════════════════════════
//  BOOT
// ══════════════════════════════════════════════════════════════

(async () => {
  await registerCommands();
  await client.login(TOKEN);
})();
