const { Client } = require('discord.js-selfbot-v13');
const config = require('../config');

// Create a new Discord client
const client = new Client();

// Function to enforce idle status
async function enforceStatus() {
    const presence = client.user.presence;

    // If the current status is not 'idle', change it to 'idle'
    if (presence.status !== 'idle') {
        console.log('Status is not idle, setting to idle...');
        try {
            await client.user.setPresence({ status: 'idle' });
            console.log('Status set to idle');
        } catch (error) {
            console.error('Failed to set status:', error);
        }
    } else {
        console.log('Status is already idle');
    }
}

// Event listener for when the bot receives a direct message
client.on('messageCreate', async (message) => {
    // Ignore messages from the bot itself
    if (message.author.id === client.user.id) return;

    // Check if the message is a direct message
    if (message.channel.type === 'DM') {
        console.log(`Received a DM: ${message.content}`);
    }
});

// Set an interval to enforce the idle status every 5 seconds
setInterval(enforceStatus, 5000);

// Event listener for when the client is ready
client.once('ready', async () => {
    console.log('Logged in as ' + client.user.tag);
    // Set initial presence to idle
    try {
        await client.user.setPresence({ status: 'idle' });
        console.log('Status set to idle');
    } catch (error) {
        console.error('Failed to set initial status:', error);
    }
});

// Login to Discord
client.login(config.userToken3).catch((err) => {
    console.error('Failed to login:', err);
});
