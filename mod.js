const { Client, GatewayIntentBits } = require('discord.js');

// Load configuration from config.js
const config = require('./config');

// Bot Token and Configurations
const BANNED_KEYWORDS = ['airdrop', 'subscribe', 'job offer', "earn", "win"]; // Add more keywords if needed
const monitoredChannels = config.monitoredChannels; // Array of channel IDs

// Initialize Discord Client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// Function to check if the message contains URLs or banned keywords
function containsProhibitedContent(messageContent) {
    const urlRegex = /(https?:\/\/[^\s]+)/g; // Matches URLs
    const containsURL = urlRegex.test(messageContent);

    const containsKeyword = BANNED_KEYWORDS.some(keyword =>
        messageContent.toLowerCase().includes(keyword)
    );

    return containsURL && containsKeyword;
}

// Event Listener: Bot Ready
client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

// Event Listener: Message Create
client.on('messageCreate', async (message) => {
    // Ignore bot messages
    if (message.author.bot) return;

    // Check if the message is in one of the monitored channels
    if (!monitoredChannels.includes(message.channel.id)) return;

    // Check for prohibited content
    if (containsProhibitedContent(message.content)) {
        try {
            // Ban the user
            await message.guild.members.ban(message.author, { reason: 'Posted prohibited content' });
            console.log(`Banned user ${message.author.tag} for posting prohibited content.`);
        } catch (error) {
            console.error(`Failed to ban user ${message.author.tag}:`, error);
        }
    }
});

// Login to Discord
client.login(config.discordToken).catch(console.error);
