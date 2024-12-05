// Import the required classes from discord.js
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const config = require('./config');

// Replace with the ID of the channel you want to send notifications to
const CHANNEL_ID = config.monitoredChannels[1];

// Create a new client instance with the necessary intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,                // Guild-related events
    GatewayIntentBits.GuildMembers,          // Member updates, including role changes
    GatewayIntentBits.GuildMessages,         // Message-related events (optional)
    GatewayIntentBits.MessageContent,        // Accessing message content (optional)
    GatewayIntentBits.DirectMessages         // Direct Messages (optional)
  ],
  partials: [Partials.Channel]               // Handle DMs if needed
});

client.login(config.discordToken).catch(console.error);

// When the bot is ready
client.once('ready', async () => {
    // Fetch all members for all guilds the bot is in
    for (const [id, guild] of client.guilds.cache) {
      await guild.members.fetch();
    }
    console.log(`${client.user.tag} has logged in and fetched all members.`);
  });
  
// Event listener for role changes
client.on('guildMemberUpdate', (oldMember, newMember) => {
    const oldRoles = oldMember.roles.cache;
    const newRoles = newMember.roles.cache;
  
    console.log("Old Roles:", oldRoles.map(r => r.name));
    console.log("New Roles:", newRoles.map(r => r.name));
  
    // Determine added/removed roles
    const addedRoles = newRoles.filter(role => !oldRoles.has(role.id));
    const removedRoles = oldRoles.filter(role => !newRoles.has(role.id));
  
    const channel = newMember.guild.channels.cache.get(CHANNEL_ID);
    if (!channel) return console.error(`Channel with ID ${CHANNEL_ID} not found.`);
  
    if (addedRoles.size > 0) {
      const addedList = addedRoles.map(role => role.name).join(', ');
      channel.send(`${newMember.user.tag} was given roles: ${addedList}`);
    }
  
    if (removedRoles.size > 0) {
      const removedList = removedRoles.map(role => role.name).join(', ');
      channel.send(`${newMember.user.tag} lost roles: ${removedList}`);
    }
  });
  

// Handle any errors
client.on('error', console.error);
