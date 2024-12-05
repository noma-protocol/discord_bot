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
client.once('ready', () => {
  console.log(`${client.user.tag} has logged in.`);
});

// Event listener for role changes
client.on('guildMemberUpdate', (oldMember, newMember) => {
  // Check if roles have been changed
  const oldRoles = oldMember.roles.cache;
  const newRoles = newMember.roles.cache;

  // Compare the size of old and new roles to determine changes
  if (oldRoles.size !== newRoles.size) {
    const addedRoles = newRoles.filter(role => !oldRoles.has(role.id));
    const removedRoles = oldRoles.filter(role => !newRoles.has(role.id));

    // Fetch the channel where you want to send the notification
    const channel = newMember.guild.channels.cache.get(CHANNEL_ID);
    if (!channel) {
      console.error(`Channel with ID ${CHANNEL_ID} not found.`);
      return;
    }

    if (addedRoles.size > 0) {
      const addedRolesList = addedRoles.map(role => role.name).join(', ');
      console.log(`${newMember.user.tag} was given roles: ${addedRolesList}`);
      channel.send(`${newMember.user.tag} was given roles: ${addedRolesList}`);
    }

    if (removedRoles.size > 0) {
      const removedRolesList = removedRoles.map(role => role.name).join(', ');
      console.log(`${newMember.user.tag} lost roles: ${removedRolesList}`);
      channel.send(`${newMember.user.tag} lost roles: ${removedRolesList}`);
    }
  }
});

// Handle any errors
client.on('error', console.error);
