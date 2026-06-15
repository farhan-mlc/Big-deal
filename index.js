// ================================================
// ADVANCED SECURITY DISCORD BOT  v3.0
// discord.js v14  |  Anti-Nuke | Anti-Bot | Auto-Mod
// ================================================

const {
  Client, GatewayIntentBits, Partials, PermissionsBitField,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  SlashCommandBuilder, REST, Routes, AuditLogEvent,
} = require("discord.js");

const ms   = require("ms");
const fs   = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "data.json");

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (e) { console.error("[DATA] Failed to load:", e.message); }
  return { banWords: [], censorWords: [] };
}

let unverifiedRoleId = null;

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify({
      banWords: [...runtimeBanWords], censorWords: [...runtimeCensorWords],
      unverifiedRoleId: unverifiedRoleId || null,
    }, null, 2));
  } catch (e) { console.error("[DATA] Failed to save:", e.message); }
}

const config = {
  token:         process.env.TOKEN,
  logsChannel:   "1511213869375422535",
  verifyChannel: "1511214137299173417",
  verifiedRole:  "1511214378110681191",
  ownerId:       "1361502272164724796",
  secondOwnerId: "1411055056072999062",
  banWords:      "mc,bc,bkl,lauda,lodi,mkc,laure,teri maa ki chuth".split(","),
  censorWords:   ["abuseword"],
  nuke: {
    ban:           { count: 3, window: 10_000 },
    kick:          { count: 3, window: 10_000 },
    channelDelete: { count: 3, window: 10_000 },
    roleDelete:    { count: 3, window: 10_000 },
    webhookCreate: { count: 4, window: 10_000 },
    channelCreate: { count: 5, window: 10_000 },
    roleCreate:    { count: 5, window: 10_000 },
  },
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration, GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildWebhooks,
  ],
  partials: [Partials.Channel],
});

const afkUsers  = new Map();
const spamMap   = new Map();
const _saved    = loadData();
const runtimeBanWords    = new Set([...config.banWords,    ...(_saved.banWords    || [])]);
const runtimeCensorWords = new Set([...config.censorWords, ...(_saved.censorWords || [])]);
unverifiedRoleId = _saved.unverifiedRoleId || null;

const whitelistedUsers = new Set([config.ownerId, config.secondOwnerId]);
const whitelistedBots  = new Set();
const nukeTracker      = new Map();
const nukePunished     = new Set();

function getLogsChannel(guild) { return guild.channels.cache.get(config.logsChannel) || null; }
function isOwner(id) { return id === config.ownerId || id === config.secondOwnerId; }
function isWhitelisted(id) { return isOwner(id) || whitelistedUsers.has(id); }

function trackNukeAction(userId, actionKey) {
  const threshold = config.nuke[actionKey];
  if (!threshold) return false;
  if (!nukeTracker.has(userId)) nukeTracker.set(userId, new Map());
  const userActions = nukeTracker.get(userId);
  if (!userActions.has(actionKey)) userActions.set(actionKey, []);
  const now = Date.now();
  const timestamps = userActions.get(actionKey).filter(t => now - t < threshold.window);
  timestamps.push(now);
  userActions.set(actionKey, timestamps);
  return timestamps.length >= threshold.count;
}

async function punishNuker(guild, executorId, reason) {
  if (isOwner(executorId)) return;
  if (nukePunished.has(`${guild.id}:${executorId}`)) return;
  nukePunished.add(`${guild.id}:${executorId}`);
  setTimeout(() => nukePunished.delete(`${guild.id}:${executorId}`), 30_000);
  const logs = getLogsChannel(guild);
  try {
    const member = await guild.members.fetch(executorId).catch(() => null);
    if (member) {
      await member.roles.remove(member.roles.cache.filter(r => r.id !== guild.id)).catch(() => {});
      await member.timeout(28 * 24 * 60 * 60 * 1000, `[ANTI-NUKE] ${reason}`).catch(() => {});
    }
    await guild.members.ban(executorId, { reason: `[ANTI-NUKE] ${reason}` }).catch(() => {});
    logs?.send({
      content: `<@${config.ownerId}>`,
      embeds: [new EmbedBuilder()
        .setTitle("🚨 ANTI-NUKE TRIGGERED")
        .setDescription(`**Action:** ${reason}\n**User:** <@${executorId}>\n**Response:** Roles stripped → Timed out → Banned`)
        .setColor("DarkRed").setTimestamp()],
    });
    for (const oid of [config.ownerId, config.secondOwnerId]) {
      const owner = await client.users.fetch(oid).catch(() => null);
      owner?.send(`🚨 **ANTI-NUKE** in **${guild.name}**\n${reason} — <@${executorId}> banned.`).catch(() => {});
    }
  } catch (err) { console.error(`[ANTI-NUKE] ${err.message}`); }
}

// ---- SLASH COMMANDS ----
const commands = [
  new SlashCommandBuilder().setName("afk").setDescription("Set your AFK status").addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),
  new SlashCommandBuilder().setName("removeafk").setDescription("Remove your AFK status"),
  new SlashCommandBuilder().setName("say").setDescription("Make the bot send a message").setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages).addStringOption(o => o.setName("message").setDescription("Message").setRequired(true)),
  new SlashCommandBuilder().setName("announcement").setDescription("Post an announcement embed").setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator).addStringOption(o => o.setName("message").setDescription("Content").setRequired(true)),
  new SlashCommandBuilder().setName("dm").setDescription("Send a DM to a user").setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator).addUserOption(o => o.setName("user").setDescription("Target user").setRequired(true)).addStringOption(o => o.setName("message").setDescription("Message").setRequired(true)),
  new SlashCommandBuilder().setName("dmall").setDescription("DM all members (owner only)").addStringOption(o => o.setName("message").setDescription("Message").setRequired(true)),
  new SlashCommandBuilder().setName("timeout").setDescription("Timeout a member").setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers).addUserOption(o => o.setName("user").setDescription("User").setRequired(true)).addStringOption(o => o.setName("duration").setDescription("e.g. 10m, 1h, 1d").setRequired(true)).addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),
  new SlashCommandBuilder().setName("untimeout").setDescription("Remove a timeout").setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers).addUserOption(o => o.setName("user").setDescription("User").setRequired(true)),
  new SlashCommandBuilder().setName("kick").setDescription("Kick a member").setDefaultMemberPermissions(PermissionsBitField.Flags.KickMembers).addUserOption(o => o.setName("user").setDescription("User").setRequired(true)).addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),
  new SlashCommandBuilder().setName("ban").setDescription("Ban a member").setDefaultMemberPermissions(PermissionsBitField.Flags.BanMembers).addUserOption(o => o.setName("user").setDescription("User").setRequired(true)).addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),
  new SlashCommandBuilder().setName("unban").setDescription("Unban a user by ID").setDefaultMemberPermissions(PermissionsBitField.Flags.BanMembers).addStringOption(o => o.setName("userid").setDescription("User ID").setRequired(true)).addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),
  new SlashCommandBuilder().setName("clear").setDescription("Bulk delete messages").setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages).addIntegerOption(o => o.setName("amount").setDescription("1–100").setMinValue(1).setMaxValue(100).setRequired(true)),
  new SlashCommandBuilder().setName("userinfo").setDescription("Get info about a user").addUserOption(o => o.setName("user").setDescription("User (default: yourself)").setRequired(false)),
  new SlashCommandBuilder().setName("serverinfo").setDescription("Get info about this server"),
  new SlashCommandBuilder().setName("filter").setDescription("Manage word filter lists").setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addSubcommand(s => s.setName("add").setDescription("Add a word").addStringOption(o => o.setName("type").setDescription("List").setRequired(true).addChoices({ name: "ban (delete + timeout)", value: "ban" }, { name: "censor (delete only)", value: "censor" })).addStringOption(o => o.setName("word").setDescription("Word").setRequired(true)))
    .addSubcommand(s => s.setName("remove").setDescription("Remove a word").addStringOption(o => o.setName("type").setDescription("List").setRequired(true).addChoices({ name: "ban", value: "ban" }, { name: "censor", value: "censor" })).addStringOption(o => o.setName("word").setDescription("Word").setRequired(true)))
    .addSubcommand(s => s.setName("list").setDescription("Show all filtered words")),
  new SlashCommandBuilder().setName("userwhitelist").setDescription("Whitelist users to bypass auto-mod").setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addSubcommand(s => s.setName("add").setDescription("Add a user").addUserOption(o => o.setName("user").setDescription("User").setRequired(true)))
    .addSubcommand(s => s.setName("remove").setDescription("Remove a user").addUserOption(o => o.setName("user").setDescription("User").setRequired(true)))
    .addSubcommand(s => s.setName("list").setDescription("Show whitelisted users")),
  new SlashCommandBuilder().setName("botwhitelist").setDescription("Allow specific bots to join").setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addSubcommand(s => s.setName("add").setDescription("Whitelist a bot by ID").addStringOption(o => o.setName("botid").setDescription("Bot ID").setRequired(true)))
    .addSubcommand(s => s.setName("remove").setDescription("Remove a bot").addStringOption(o => o.setName("botid").setDescription("Bot ID").setRequired(true)))
    .addSubcommand(s => s.setName("list").setDescription("Show whitelisted bots")),
  new SlashCommandBuilder().setName("nukewhitelist").setDescription("Whitelist users from anti-nuke").setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addSubcommand(s => s.setName("add").setDescription("Add trusted user").addUserOption(o => o.setName("user").setDescription("User").setRequired(true)))
    .addSubcommand(s => s.setName("remove").setDescription("Remove trusted user").addUserOption(o => o.setName("user").setDescription("User").setRequired(true)))
    .addSubcommand(s => s.setName("list").setDescription("Show trusted users")),
  new SlashCommandBuilder().setName("security").setDescription("Show security system status").setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
  new SlashCommandBuilder().setName("setup-verify").setDescription("Set up verification gate").setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
].map(c => c.toJSON());

// ---- READY ----
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  try {
    const rest = new REST({ version: "10" }).setToken(config.token);
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log(`✅ Registered ${commands.length} slash commands`);
  } catch (err) { console.error("❌ Command register failed:", err.message); }
});

// ---- ANTI-NUKE ----
client.on("guildAuditLogEntryCreate", async (entry, guild) => {
  const executorId = entry.executorId;
  if (!executorId || isWhitelisted(executorId)) return;
  const actionMap = {
    [AuditLogEvent.MemberBanAdd]:  "ban",
    [AuditLogEvent.MemberKick]:    "kick",
    [AuditLogEvent.ChannelDelete]: "channelDelete",
    [AuditLogEvent.RoleDelete]:    "roleDelete",
    [AuditLogEvent.WebhookCreate]: "webhookCreate",
    [AuditLogEvent.ChannelCreate]: "channelCreate",
    [AuditLogEvent.RoleCreate]:    "roleCreate",
  };
  const actionKey = actionMap[entry.action];
  if (!actionKey) return;
  if (trackNukeAction(executorId, actionKey)) {
    const labels = { ban: "Mass Ban", kick: "Mass Kick", channelDelete: "Mass Channel Delete", roleDelete: "Mass Role Delete", webhookCreate: "Mass Webhook Creation", channelCreate: "Mass Channel Creation", roleCreate: "Mass Role Creation" };
    await punishNuker(guild, executorId, labels[actionKey] || actionKey);
  }
});

// ---- MEMBER JOIN ----
client.on("guildMemberAdd", async member => {
  const logs = getLogsChannel(member.guild);
  if (member.user.bot) {
    if (!whitelistedBots.has(member.user.id)) {
      await member.kick("Unauthorized bot").catch(() => {});
      logs?.send({ embeds: [new EmbedBuilder().setTitle("🤖 Unauthorized Bot Kicked").setDescription(`${member.user.tag} (\`${member.user.id}\`) — not whitelisted.`).setColor("Red").setTimestamp()] });
    } else {
      logs?.send({ embeds: [new EmbedBuilder().setTitle("✅ Whitelisted Bot Joined").setDescription(`${member.user.tag}`).setColor("Green").setTimestamp()] });
    }
    return;
  }
  const ageDays = Math.floor((Date.now() - member.user.createdTimestamp) / 86_400_000);
  if (ageDays < 7 && logs) logs.send({ embeds: [new EmbedBuilder().setTitle("⚠️ Possible Alt Account").setDescription(`${member} joined — Account age: **${ageDays} day(s)**`).setColor("Orange").setTimestamp()] });
  if (unverifiedRoleId) { const r = member.guild.roles.cache.get(unverifiedRoleId); if (r) await member.roles.add(r).catch(() => {}); }
  if (config.verifyChannel) {
    const vc = member.guild.channels.cache.get(config.verifyChannel);
    vc?.send({ content: `${member}`, embeds: [new EmbedBuilder().setTitle("🔐 Verification Required").setDescription(`Welcome to **${member.guild.name}**!\nClick the button below to verify.`).setColor("Green").setTimestamp()], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("verify").setLabel("✅ Verify Me").setStyle(ButtonStyle.Success))] });
  }
});

// ---- MESSAGE — AFK + Spam + Word Filter ----
client.on("messageCreate", async message => {
  if (message.author.bot || !message.guild) return;
  const userId = message.author.id;
  const content = message.content.toLowerCase();

  if (message.mentions.users.size > 0) {
    for (const [id, user] of message.mentions.users) {
      if (afkUsers.has(id)) {
        const { reason } = afkUsers.get(id);
        await message.reply({ content: `💤 **${user.username}** is AFK: ${reason}`, allowedMentions: { repliedUser: false } }).catch(() => {});
      }
    }
  }
  if (afkUsers.has(userId)) {
    afkUsers.delete(userId);
    await message.reply({ content: "✅ Welcome back! AFK removed.", allowedMentions: { repliedUser: false } }).catch(() => {});
  }

  if (isWhitelisted(userId)) return;

  const hasBanWord    = [...runtimeBanWords].some(w => content.includes(w.toLowerCase()));
  const hasCensorWord = [...runtimeCensorWords].some(w => content.includes(w.toLowerCase()));

  if (hasBanWord) {
    await message.delete().catch(() => {});
    try { await message.member?.timeout(5 * 60 * 1000, "Banned word"); } catch {}
    const w = await message.channel.send({ embeds: [new EmbedBuilder().setDescription(`🚫 ${message.author}, banned word used. Timed out 5 min.`).setColor("Red")] });
    setTimeout(() => w.delete().catch(() => {}), 5000);
    getLogsChannel(message.guild)?.send({ embeds: [new EmbedBuilder().setTitle("🚫 Banned Word").addFields({ name: "User", value: `${message.author.tag}`, inline: true }, { name: "Channel", value: `<#${message.channel.id}>`, inline: true }).setColor("DarkRed").setTimestamp()] });
    return;
  }
  if (hasCensorWord) {
    await message.delete().catch(() => {});
    const w = await message.channel.send({ embeds: [new EmbedBuilder().setDescription(`⚠️ ${message.author}, message removed (filtered word).`).setColor("Orange")] });
    setTimeout(() => w.delete().catch(() => {}), 5000);
    return;
  }

  const now = Date.now();
  if (!spamMap.has(userId)) spamMap.set(userId, []);
  const ts = spamMap.get(userId).filter(t => now - t < 5000);
  ts.push(now);
  spamMap.set(userId, ts);
  if (ts.length >= 5) {
    spamMap.delete(userId);
    try {
      await message.member?.timeout(60 * 1000, "Spam");
      await message.channel.send({ embeds: [new EmbedBuilder().setDescription(`🛑 ${message.author}, timed out 1 min for spamming.`).setColor("Red")] });
      getLogsChannel(message.guild)?.send({ embeds: [new EmbedBuilder().setTitle("🛑 Spam Detected").addFields({ name: "User", value: `${message.author.tag}`, inline: true }, { name: "Channel", value: `<#${message.channel.id}>`, inline: true }).setColor("Orange").setTimestamp()] });
    } catch {}
  }
});

// ---- INTERACTIONS ----
client.on("interactionCreate", async interaction => {
  if (interaction.isButton() && interaction.customId === "verify") {
    const role = interaction.guild.roles.cache.get(config.verifiedRole);
    if (!role) return interaction.reply({ content: "⚠️ Verified role not found.", ephemeral: true });
    if (interaction.member.roles.cache.has(role.id)) return interaction.reply({ content: "✅ Already verified!", ephemeral: true });
    try {
      await interaction.member.roles.add(role);
      if (unverifiedRoleId) { const ur = interaction.guild.roles.cache.get(unverifiedRoleId); if (ur) await interaction.member.roles.remove(ur).catch(() => {}); }
      await interaction.reply({ embeds: [new EmbedBuilder().setTitle("✅ Verified!").setDescription(`Welcome to **${interaction.guild.name}**!`).setColor("Green").setTimestamp()], ephemeral: true });
      const user = interaction.user, member = interaction.member;
      const accAge = Math.floor((Date.now() - user.createdTimestamp) / 86_400_000);
      const embed = new EmbedBuilder().setTitle("🔓 New Member Verified").setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
        .addFields({ name: "👤 Username", value: user.tag, inline: true }, { name: "🆔 User ID", value: `\`${user.id}\``, inline: true }, { name: "📅 Account Created", value: `<t:${Math.floor(user.createdTimestamp / 1000)}:F>` }, { name: "📥 Joined Server", value: member.joinedAt ? `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:F>` : "Unknown" }, { name: "🗓️ Account Age", value: `${accAge} days`, inline: true })
        .setColor("Green").setTimestamp();
      for (const oid of [config.ownerId, config.secondOwnerId]) { const o = await client.users.fetch(oid).catch(() => null); o?.send({ embeds: [embed] }).catch(() => {}); }
      getLogsChannel(interaction.guild)?.send({ embeds: [embed] });
    } catch { interaction.reply({ content: "❌ Failed. Check bot permissions.", ephemeral: true }); }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;
  try { await interaction.deferReply({ ephemeral: true }); } catch { return; }

  try {
    if (commandName === "afk") { afkUsers.set(interaction.user.id, { reason: interaction.options.getString("reason") || "AFK" }); return interaction.editReply({ content: `✅ AFK set.` }); }
    if (commandName === "removeafk") { if (!afkUsers.has(interaction.user.id)) return interaction.editReply({ content: "ℹ️ You are not AFK." }); afkUsers.delete(interaction.user.id); return interaction.editReply({ content: "✅ AFK removed." }); }
    if (commandName === "say") { await interaction.channel.send(interaction.options.getString("message")); return interaction.editReply({ content: "✅ Sent." }); }
    if (commandName === "announcement") { await interaction.channel.send({ embeds: [new EmbedBuilder().setTitle("📢 Announcement").setDescription(interaction.options.getString("message")).setColor("Blue").setFooter({ text: `By ${interaction.user.tag}` }).setTimestamp()] }); return interaction.editReply({ content: "✅ Posted." });
  // ---- Spam Detection (5 msgs in 5s) ----
  const now = Date.now();
  if (!spamMap.has(userId)) spamMap.set(userId, []);
  const ts = spamMap.get(userId).filter(t => now - t < 5000);
  ts.push(now);
  spamMap.set(userId, ts);
  if (ts.length >= 5) {
    spamMap.delete(userId);
    try {
      await message.member?.timeout(60 * 1000, "Spam");
      await message.channel.send({ embeds: [new EmbedBuilder().setDescription(`🛑 ${message.author}, timed out 1 min for spamming.`).setColor("Red")] });
      getLogsChannel(message.guild)?.send({ embeds: [new EmbedBuilder().setTitle("🛑 Spam Detected").addFields({ name: "User", value: `${message.author.tag}`, inline: true }, { name: "Channel", value: `<#${message.channel.id}>`, inline: true }).setColor("Orange").setTimestamp()] });
    } catch {}
  }
});

// ================================================
// INTERACTIONS
// ================================================

client.on("interactionCreate", async interaction => {
  if (interaction.isButton() && interaction.customId === "verify") {
    const role = interaction.guild.roles.cache.get(config.verifiedRole);
    if (!role) return interaction.reply({ content: "⚠️ Verified role not found.", ephemeral: true });
    if (interaction.member.roles.cache.has(role.id)) return interaction.reply({ content: "✅ Already verified!", ephemeral: true });
    try {
      await interaction.member.roles.add(role);
      if (unverifiedRoleId) { const ur = interaction.guild.roles.cache.get(unverifiedRoleId); if (ur) await interaction.member.roles.remove(ur).catch(() => {}); }
      await interaction.reply({ embeds: [new EmbedBuilder().setTitle("✅ Verified!").setDescription(`Welcome to **${interaction.guild.name}**!`).setColor("Green").setTimestamp()], ephemeral: true });
      const user = interaction.user, member = interaction.member;
      const accAge = Math.floor((Date.now() - user.createdTimestamp) / 86_400_000);
      const embed = new EmbedBuilder().setTitle("🔓 New Member Verified")
        .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
        .addFields(
          { name: "👤 Username", value: user.tag, inline: true },
          { name: "🆔 User ID", value: `\`${user.id}\``, inline: true },
          { name: "📅 Account Created", value: `<t:${Math.floor(user.createdTimestamp / 1000)}:F>` },
          { name: "📥 Joined Server", value: member.joinedAt ? `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:F>` : "Unknown" },
          { name: "🗓️ Account Age", value: `${accAge} days`, inline: true }
        ).setColor("Green").setTimestamp();
      for (const oid of [config.ownerId, config.secondOwnerId]) {
        const o = await client.users.fetch(oid).catch(() => null);
        o?.send({ embeds: [embed] }).catch(() => {});
      }
      getLogsChannel(interaction.guild)?.send({ embeds: [embed] });
    } catch { interaction.reply({ content: "❌ Failed. Check bot permissions.", ephemeral: true }); }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;
  try { await interaction.deferReply({ ephemeral: true }); } catch { return; }

  try {
    if (commandName === "afk") { afkUsers.set(interaction.user.id, { reason: interaction.options.getString("reason") || "AFK" }); return interaction.editReply({ content: `✅ AFK set.` }); }
    if (commandName === "removeafk") { if (!afkUsers.has(interaction.user.id)) return interaction.editReply({ content: "ℹ️ You are not AFK." }); afkUsers.delete(interaction.user.id); return interaction.editReply({ content: "✅ AFK removed." }); }
    if (commandName === "say") { await interaction.channel.send(interaction.options.getString("message")); return interaction.editReply({ content: "✅ Sent." }); }
    if (commandName === "announcement") { await interaction.channel.send({ embeds: [new EmbedBuilder().setTitle("📢 Announcement").setDescription(interaction.options.getString("message")).setColor("Blue").setFooter({ text: `By ${interaction.user.tag}` }).setTimestamp()] }); return interaction.editReply({ content: "✅ Posted." }); }
    if (commandName === "dm") { await interaction.options.getUser("user").send(interaction.options.getString("message")); return interaction.editReply({ content: "✅ DM sent." }); }
    if (commandName === "dmall") {
      if (!isOwner(interaction.user.id)) return interaction.editReply({ content: "❌ Owner only." });
      const text = interaction.options.getString("message"); let sent = 0;
      await interaction.editReply({ content: "📨 Sending…" });
      interaction.guild.members.cache.forEach(m => { if (!m.user.bot) m.send(text).then(() => sent++).catch(() => {}); });
      setTimeout(() => interaction.followUp({ content: `✅ Sent to **${sent}** members.`, ephemeral: true }).catch(() => {}), 3000);
      return;
    }
    if (commandName === "timeout") {
      const target = interaction.options.getMember("user"), duration = interaction.options.getString("duration"), reason = interaction.options.getString("reason") || "No reason";
      if (!target) return interaction.editReply({ content: "❌ Member not found." });
      const dur = ms(duration); if (!dur) return interaction.editReply({ content: "❌ Invalid duration. Use: 10m, 1h, 7d" });
      await target.timeout(dur, reason);
      getLogsChannel(interaction.guild)?.send({ embeds: [new EmbedBuilder().setTitle("⏱️ Timed Out").addFields({ name: "User", value: target.user.tag, inline: true }, { name: "Duration", value: duration, inline: true }, { name: "Reason", value: reason }, { name: "By", value: interaction.user.tag, inline: true }).setColor("Orange").setTimestamp()] });
      return interaction.editReply({ content: `✅ **${target.user.tag}** timed out for **${duration}**.` });
    }
    if (commandName === "untimeout") {
      const target = interaction.options.getMember("user"); if (!target) return interaction.editReply({ content: "❌ Not found." });
      await target.timeout(null); return interaction.editReply({ content: `✅ Timeout removed for **${target.user.tag}**.` });
    }
    if (commandName === "kick") {
      const target = interaction.options.getMember("user"), reason = interaction.options.getString("reason") || "No reason";
      if (!target) return interaction.editReply({ content: "❌ Not found." });
      await target.kick(reason);
      getLogsChannel(interaction.guild)?.send({ embeds: [new EmbedBuilder().setTitle("👢 Kicked").addFields({ name: "User", value: target.user.tag, inline: true }, { name: "Reason", value: reason }, { name: "By", value: interaction.user.tag, inline: true }).setColor("Orange").setTimestamp()] });
      return interaction.editReply({ content: `✅ **${target.user.tag}** kicked.` });
    }
    if (commandName === "ban") {
      const target = interaction.options.getMember("user"), reason = interaction.options.getString("reason") || "No reason";
      if (!target) return interaction.editReply({ content: "❌ Not found." });
      await target.ban({ reason });
      getLogsChannel(interaction.guild)?.send({ embeds: [new EmbedBuilder().setTitle("🔨 Banned").addFields({ name: "User", value: target.user.tag, inline: true }, { name: "Reason", value: reason }, { name: "By", value: interaction.user.tag, inline: true }).setColor("DarkRed").setTimestamp()] });
      return interaction.editReply({ content: `✅ **${target.user.tag}** banned.` });
    }
    if (commandName === "unban") {
      const userId = interaction.options.getString("userid"), reason = interaction.options.getString("reason") || "No reason";
      await interaction.guild.members.unban(userId, reason);
      return interaction.editReply({ content: `✅ \`${userId}\` unbanned.` });
    }
    if (commandName === "clear") {
      const deleted = await interaction.channel.bulkDelete(interaction.options.getInteger("amount"), true);
      return interaction.editReply({ content: `✅ Deleted **${deleted.size}** messages.` });
    }
    if (commandName === "userinfo") {
      const user = interaction.options.getUser("user") || interaction.user;
      const member = interaction.guild.members.cache.get(user.id);
      const accAge = Math.floor((Date.now() - user.createdTimestamp) / 86_400_000);
      return interaction.editReply({ embeds: [new EmbedBuilder().setTitle(`👤 ${user.tag}`).setThumbnail(user.displayAvatarURL({ dynamic: true })).addFields({ name: "🆔 ID", value: `\`${user.id}\``, inline: true }, { name: "🤖 Bot", value: user.bot ? "Yes" : "No", inline: true }, { name: "📅 Created", value: `<t:${Math.floor(user.createdTimestamp / 1000)}:F>` }, { name: "🗓️ Age", value: `${accAge} days`, inline: true }, { name: "📥 Joined", value: member?.joinedAt ? `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:F>` : "N/A" }, { name: "🎭 Roles", value: member ? member.roles.cache.filter(r => r.id !== interaction.guild.id).map(r => `<@&${r.id}>`).join(", ") || "None" : "N/A" }).setColor("Blue").setTimestamp()] });
    }
    if (commandName === "serverinfo") {
      const g = interaction.guild; await g.fetch();
      return interaction.editReply({ embeds: [new EmbedBuilder().setTitle(`🏠 ${g.name}`).setThumbnail(g.iconURL({ dynamic: true })).addFields({ name: "🆔 ID", value: g.id, inline: true }, { name: "👑 Owner", value: `<@${g.ownerId}>`, inline: true }, { name: "👥 Members", value: `${g.memberCount}`, inline: true }, { name: "📅 Created", value: `<t:${Math.floor(g.createdTimestamp / 1000)}:F>` }, { name: "💬 Channels", value: `${g.channels.cache.size}`, inline: true }, { name: "🎭 Roles", value: `${g.roles.cache.size}`, inline: true }, { name: "😀 Emojis", value: `${g.emojis.cache.size}`, inline: true }).setColor("Blue").setTimestamp()] });
    }
    if (commandName === "filter") {
      const sub = interaction.options.getSubcommand(), type = interaction.options.getString("type"), word = interaction.options.getString("word")?.toLowerCase();
      if (sub === "add") { (type === "ban" ? runtimeBanWords : runtimeCensorWords).add(word); saveData(); return interaction.editReply({ content: `✅ **\`${word}\`** added to **${type}** list.` }); }
      if (sub === "remove") { const removed = (type === "ban" ? runtimeBanWords : runtimeCensorWords).delete(word); saveData(); return interaction.editReply({ content: removed ? `✅ Removed.` : `❌ Word not found.` }); }
      if (sub === "list") return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("🔤 Word Filter Lists").addFields({ name: "🚫 Ban List", value: [...runtimeBanWords].join(", ") || "Empty" }, { name: "⚠️ Censor List", value: [...runtimeCensorWords].join(", ") || "Empty" }).setColor("Blue").setTimestamp()] });
    }
    if (commandName === "userwhitelist") {
      const sub = interaction.options.getSubcommand(), user = interaction.options.getUser("user");
      if (sub === "add") { whitelistedUsers.add(user.id); return interaction.editReply({ content: `✅ **${user.tag}** whitelisted.` }); }
      if (sub === "remove") { if (isOwner(user.id)) return interaction.editReply({ content: "❌ Cannot remove owner." }); whitelistedUsers.delete(user.id); return interaction.editReply({ content: `✅ Removed.` }); }
      if (sub === "list") return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("👥 Whitelisted Users").setDescription([...whitelistedUsers].map(id => `<@${id}>`).join("\n") || "None").setColor("Blue").setTimestamp()] });
    }
    if (commandName === "botwhitelist") {
      const sub = interaction.options.getSubcommand(), botId = interaction.options.getString("botid");
      if (sub === "add") { whitelistedBots.add(botId); return interaction.editReply({ content: `✅ Bot \`${botId}\` whitelisted.` }); }
      if (sub === "remove") { whitelistedBots.delete(botId); return interaction.editReply({ content: `✅ Removed.` }); }
      if (sub === "list") return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("🤖 Whitelisted Bots").setDescription([...whitelistedBots].join("\n") || "None").setColor("Blue").setTimestamp()] });
    }
    if (commandName === "nukewhitelist") {
      const sub = interaction.options.getSubcommand(), user = interaction.options.getUser("user");
      if (sub === "add") { whitelistedUsers.add(user.id); return interaction.editReply({ content: `✅ **${user.tag}** added to nuke whitelist.` }); }
      if (sub === "remove") { if (isOwner(user.id)) return interaction.editReply({ content: "❌ Cannot remove owner." }); whitelistedUsers.delete(user.id); return interaction.editReply({ content: `✅ Removed.` }); }
      if (sub === "list") return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("🛡️ Nuke Whitelist").setDescription([...whitelistedUsers].map(id => `<@${id}>`).join("\n") || "None").setColor("Blue").setTimestamp()] });
    }
    if (commandName === "security") {
      return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("🔒 Security Status").addFields({ name: "🚨 Anti-Nuke", value: "✅ Active", inline: true }, { name: "🤖 Anti-Bot", value: "✅ Active", inline: true }, { name: "🛑 Anti-Spam", value: "✅ Active (5 msgs/5s)", inline: true }, { name: "🚫 Word Filter", value: `Ban: **${runtimeBanWords.size}** | Censor: **${runtimeCensorWords.size}**` }, { name: "👥 Whitelisted Users", value: `${whitelistedUsers.size}`, inline: true }, { name: "🤖 Whitelisted Bots", value: `${whitelistedBots.size}`, inline: true }, { name: "🔐 Verification", value: unverifiedRoleId ? "✅ Enabled" : "⚠️ Run /setup-verify" }, { name: "📋 Nuke Limits", value: Object.entries(config.nuke).map(([k, v]) => `**${k}**: ${v.count}/${v.window / 1000}s`).join("\n") }).setColor("DarkGreen").setTimestamp()] });
    }
    if (commandName === "setup-verify") {
      const unverRole = interaction.guild.roles.cache.find(r => r.name.toLowerCase().includes("unverif") || r.name.toLowerCase().includes("member"));
      if (!unverRole) return interaction.editReply({ content: "❌ Create a role named **Unverified** first." });
      unverifiedRoleId = unverRole.id; saveData();
      const vc = interaction.guild.channels.cache.get(config.verifyChannel);
      if (vc) await vc.send({ embeds: [new EmbedBuilder().setTitle("🔐 Verification Required").setDescription(`Click below to verify and get access.`).setColor("Green").setTimestamp()], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("verify").setLabel("✅ Verify Me").setStyle(ButtonStyle.Success))] });
      return interaction.editReply({ content: `✅ Verification set up! Unverified Role: <@&${unverRole.id}>` });
    }
  } catch (err) {
    console.error(`[CMD:${commandName}]`, err);
    interaction.editReply({ content: `❌ Error: ${err.message}` }).catch(() => {});
  }
});

process.on("unhandledRejection", err => console.error("[Unhandled Rejection]", err));
process.on("uncaughtException",  err => console.error("[Uncaught Exception]", err));

client.login(config.token);
