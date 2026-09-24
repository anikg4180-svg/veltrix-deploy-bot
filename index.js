require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require("discord.js");
const axios = require("axios");

const {
  DISCORD_TOKEN,
  CLIENT_ID,
  GUILD_ID,
  PTERODACTYL_URL,
  PTERODACTYL_API_KEY,
  NODE_ID,
  EGG_ID,
  ALLOCATION_ID,
  DOCKER_IMAGE,
  STARTUP,
  DEFAULT_DATABASE_LIMIT,
  DEFAULT_BACKUP_LIMIT,
  DEFAULT_CPU,
  DEFAULT_DISK,
} = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID || !PTERODACTYL_URL || !PTERODACTYL_API_KEY) {
  console.error("Missing required environment variables.");
  process.exit(1);
}

const panel = axios.create({
  baseURL: PTERODACTYL_URL.replace(/\/+$/, "") + "/api/application",
  headers: {
    Authorization: `Bearer ${PTERODACTYL_API_KEY}`,
    Accept: "Application/vnd.pterodactyl.v1+json",
    "Content-Type": "application/json",
  },
  timeout: 20000,
});

function adminOnly(builder) {
  return builder.setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
}

async function getUserByEmail(email) {
  let page = 1;
  while (true) {
    const r = await panel.get("/users", { params: { filter: `email:${email}`, page } });
    const users = r.data.data || [];
    const exact = users.find(x => x.attributes?.email?.toLowerCase() === email.toLowerCase());
    if (exact) return exact.attributes;

    const last = r.data.meta?.pagination?.current_page >= r.data.meta?.pagination?.total_pages;
    if (last || users.length === 0) return null;
    page++;
  }
}

async function getServersForUser(userId) {
  let page = 1;
  const out = [];
  while (true) {
    const r = await panel.get("/servers", {
      params: { "filter[user]": userId, page }
    });
    out.push(...(r.data.data || []).map(x => x.attributes));
    const p = r.data.meta?.pagination;
    if (!p || p.current_page >= p.total_pages) break;
    page++;
  }
  return out;
}

async function getServerById(id) {
  const r = await panel.get(`/servers/${encodeURIComponent(id)}`);
  return r.data.attributes;
}

async function findServerForUser(email, serverIdOrName) {
  const user = await getUserByEmail(email);
  if (!user) throw new Error(`No Pterodactyl user found for ${email}.`);
  const servers = await getServersForUser(user.id);
  if (!servers.length) throw new Error(`No servers found for ${email}.`);

  if (!serverIdOrName) return servers[0];

  const q = serverIdOrName.toLowerCase();
  return servers.find(s =>
    String(s.id) === q ||
    String(s.identifier).toLowerCase() === q ||
    String(s.name).toLowerCase() === q
  ) || null;
}

function intOption(name, description, required = true) {
  return o => o.setName(name).setDescription(description).setRequired(required).setInteger(true).setMinValue(1);
}

const commands = [
  adminOnly(new SlashCommandBuilder()
    .setName("list")
    .setDescription("List Pterodactyl users")),

  adminOnly(new SlashCommandBuilder()
    .setName("user-create")
    .setDescription("Create a Pterodactyl user")
    .addStringOption(o => o.setName("email").setDescription("User email").setRequired(true))
    .addStringOption(o => o.setName("password").setDescription("Initial password").setRequired(true))
    .addStringOption(o => o.setName("username").setDescription("Username").setRequired(true))
    .addStringOption(o => o.setName("first-name").setDescription("First name").setRequired(false))
    .addStringOption(o => o.setName("last-name").setDescription("Last name").setRequired(false))),

  adminOnly(new SlashCommandBuilder()
    .setName("server-create")
    .setDescription("Create a Pterodactyl server")
    .addIntegerOption(intOption("ram", "RAM in MB"))
    .addIntegerOption(intOption("cpu", "CPU limit in percent"))
    .addIntegerOption(intOption("disk", "Disk in MB"))
    .addStringOption(o => o.setName("email").setDescription("Owner email").setRequired(true))
    .addStringOption(o => o.setName("name").setDescription("Server name").setRequired(false))),

  adminOnly(new SlashCommandBuilder()
    .setName("server-delete")
    .setDescription("Delete a server owned by an email")
    .addStringOption(o => o.setName("email").setDescription("Owner email").setRequired(true))
    .addStringOption(o => o.setName("server").setDescription("Server ID, identifier or name").setRequired(false))),

  adminOnly(new SlashCommandBuilder()
    .setName("server-reinstall")
    .setDescription("Reinstall a server owned by an email")
    .addStringOption(o => o.setName("email").setDescription("Owner email").setRequired(true))
    .addStringOption(o => o.setName("server").setDescription("Server ID, identifier or name").setRequired(false))),

  adminOnly(new SlashCommandBuilder()
    .setName("delete")
    .setDescription("Alias for server-delete")
    .addStringOption(o => o.setName("email").setDescription("Owner email").setRequired(true))
    .addStringOption(o => o.setName("server").setDescription("Server ID, identifier or name").setRequired(false))),

  adminOnly(new SlashCommandBuilder()
    .setName("restart")
    .setDescription("Restart a server using its identifier")
    .addStringOption(o => o.setName("identifier").setDescription("Server identifier").setRequired(true))),

  adminOnly(new SlashCommandBuilder()
    .setName("status")
    .setDescription("Show server details")
    .addStringOption(o => o.setName("identifier").setDescription("Server identifier").setRequired(true))),

  adminOnly(new SlashCommandBuilder()
    .setName("servers")
    .setDescription("List servers owned by an email")
    .addStringOption(o => o.setName("email").setDescription("Owner email").setRequired(true))),
].map(c => c.toJSON());

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );
  console.log("Slash commands registered.");
}

function maskSecret(s) {
  if (!s) return "";
  return s.length <= 4 ? "****" : s.slice(0, 2) + "****" + s.slice(-2);
}

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {
    await interaction.deferReply({ ephemeral: true });

    const cmd = interaction.commandName;

    if (cmd === "list") {
      const r = await panel.get("/users", { params: { per_page: 100 } });
      const users = r.data.data || [];
      if (!users.length) return interaction.editReply("No Pterodactyl users found.");
      const lines = users.slice(0, 50).map(x => {
        const u = x.attributes;
        return `• **${u.username}** — ${u.email} — ID: \`${u.id}\``;
      });
      return interaction.editReply(`**Pterodactyl Users**\n${lines.join("\n")}`);
    }

    if (cmd === "user-create") {
      const email = interaction.options.getString("email");
      const password = interaction.options.getString("password");
      const username = interaction.options.getString("username");
      const first = interaction.options.getString("first-name") || username;
      const last = interaction.options.getString("last-name") || "User";

      if (await getUserByEmail(email)) {
        return interaction.editReply(`A user with **${email}** already exists.`);
      }

      const r = await panel.post("/users", {
        email,
        username,
        first_name: first,
        last_name: last,
        password,
        root_admin: false,
        language: "en",
      });

      const u = r.data.attributes;
      return interaction.editReply(
        `✅ User created.\n**Username:** \`${u.username}\`\n**Email:** \`${u.email}\`\n**User ID:** \`${u.id}\``
      );
    }

    if (cmd === "server-create") {
      const ram = interaction.options.getInteger("ram");
      const cpu = interaction.options.getInteger("cpu");
      const disk = interaction.options.getInteger("disk");
      const email = interaction.options.getString("email");
      const name = interaction.options.getString("name") || `Veltrix-${Date.now()}`;

      const user = await getUserByEmail(email);
      if (!user) return interaction.editReply(`No Pterodactyl user found for **${email}**.`);

      if (!NODE_ID || !EGG_ID || !ALLOCATION_ID || !DOCKER_IMAGE || !STARTUP) {
        return interaction.editReply("Server creation is not configured. Set NODE_ID, EGG_ID, ALLOCATION_ID, DOCKER_IMAGE and STARTUP in Render.");
      }

      const r = await panel.post("/servers", {
        name,
        user: user.id,
        nest: Number(process.env.NEST_ID || 1),
        egg: Number(EGG_ID),
        docker_image: DOCKER_IMAGE,
        startup: STARTUP,
        environment: {},
        limits: {
          memory: ram,
          swap: 0,
          disk,
          io: 500,
          cpu,
          threads: null,
        },
        feature_limits: {
          databases: Number(DEFAULT_DATABASE_LIMIT || 0),
          backups: Number(DEFAULT_BACKUP_LIMIT || 0),
          allocations: 1,
        },
        deployment: {
          locations: [Number(process.env.LOCATION_ID || 1)],
          dedicated_ip: false,
          port_range: [],
        },
        allocation: {
          default: Number(ALLOCATION_ID),
        },
        start_on_completion: true,
      });

      const s = r.data.attributes;
      return interaction.editReply(
        `✅ Server created.\n**Name:** \`${s.name}\`\n**Identifier:** \`${s.identifier}\`\n**Owner:** \`${email}\`\n**RAM:** ${ram} MB\n**CPU:** ${cpu}%\n**Disk:** ${disk} MB`
      );
    }

    if (cmd === "server-delete" || cmd === "delete") {
      const email = interaction.options.getString("email");
      const selector = interaction.options.getString("server");
      const s = await findServerForUser(email, selector);
      if (!s) return interaction.editReply("Server not found. Use `/servers` to see the owner's servers.");

      await panel.delete(`/servers/${s.id}`);
      return interaction.editReply(
  `🗑️ Deleted ${s.name} (${s.identifier}) for ${email}.`
);
    if (cmd === "server-reinstall") {
      const email = interaction.options.getString("email");
      const selector = interaction.options.getString("server");
      const s = await findServerForUser(email, selector);
      if (!s) return interaction.editReply("Server not found. Use `/servers` to see the owner's servers.");

      await panel.post(`/servers/${s.id}/reinstall`);
      return interaction.editReply(
  `♻️ Reinstall started for ${s.name} (${s.identifier}).`
);

    if (cmd === "servers") {
      const email = interaction.options.getString("email");
      const user = await getUserByEmail(email);
      if (!user) return interaction.editReply(`No user found for **${email}**.`);

      const servers = await getServersForUser(user.id);
      if (!servers.length) return interaction.editReply(`No servers found for **${email}**.`);

      const lines = servers.map(s =>
        `• **${s.name}** — \`${s.identifier}\` — ${s.limits.memory}MB RAM / ${s.limits.disk}MB Disk / ${s.limits.cpu}% CPU`
      );
      return interaction.editReply(`**Servers for ${email}**\n${lines.join("\n")}`);
    }

    if (cmd === "status") {
      const id = interaction.options.getString("identifier");
      const s = await getServerById(id);
      return interaction.editReply(
        `**${s.name}**\nID: \`${s.identifier}\`\nUUID: \`${s.uuid}\`\nOwner ID: \`${s.user}\`\nRAM: ${s.limits.memory} MB\nDisk: ${s.limits.disk} MB\nCPU: ${s.limits.cpu}%\nNode: ${s.node}`
      );
    }

    if (cmd === "restart") {
      return interaction.editReply(
        "For restart, this bot needs a Pterodactyl **Client API token for the target server**. The Application API key cannot safely act as a server owner. I left this command as a protected placeholder instead of storing user/server tokens."
      );
    }
  } catch (err) {
    const data = err.response?.data;
    console.error("API error:", data || err);
    const detail =
      data?.errors?.map(e => e.detail).join("\n") ||
      data?.message ||
      err.message ||
      "Unknown error";
    return interaction.editReply(`❌ ${detail}`.slice(0, 1900));
  }
});

registerCommands()
  .then(() => client.login(DISCORD_TOKEN))
  .catch(err => {
    console.error("Startup failed:", err.response?.data || err);
    process.exit(1);
  });
