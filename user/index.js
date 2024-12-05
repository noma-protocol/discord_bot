const { Client } = require('discord.js-selfbot-v13');
const axios = require('axios'); // Use axios to make requests to the OpenAI API
const OpenAI = require('openai');
const config = require('../config');

// Create a new Discord client
const client = new Client();

const openaiApiKey = '' // Replace with your actual OpenAI API key

// OpenAI API setup
const openai = new OpenAI({
    apiKey: openaiApiKey,
});

// Function to set the status to "idle"
async function setIdleStatus() {
    try {
        await client.user.setPresence({
            status: 'idle', // Sets the status to 'idle'
            afk: true, // Indicates the user is away from keyboard
            activities: [] // Clear any activities
        });
        console.log('Status set to idle');
    } catch (error) {
        console.error('Failed to set status:', error);
    }
}

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

// Function to get ChatGPT response using OpenAI API
// async function getChatGPTResponse(messageContent) {
//     try {
//         const response = await axios.post(
//             'https://api.openai.com/v1/chat/completions',
//             {
//                 model: 'gpt-3.5-turbo',
//                 messages: [{ role: 'user', content: messageContent }],
//                 max_tokens: 100,
//             },
//             {
//                 headers: {
//                     'Authorization': `Bearer ${openaiApiKey}`,
//                     'Content-Type': 'application/json',
//                 },
//             }
//         );

//         return response.data.choices[0].message.content;
//     } catch (error) {
//         console.error("Error with OpenAI API:", error.response ? error.response.data : error.message);
//         return "Sorry, I couldn't process your request.";
//     }
// }

// Event listener for when the bot receives a direct message
client.on('messageCreate', async (message) => {
    // Ignore messages from the bot itself
    if (message.author.id === client.user.id) return;

    // Check if the message is a direct message
    if (message.channel.type === 'DM') {
        console.log(`Received a DM: ${message.content}`);

        // Generate a response using ChatGPT
        // const response = await getChatGPTResponse(message.content);

        // Send the response back to the user
        // message.channel.send(response).catch(console.error);
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
client.login(config.userToken).catch((err) => {
    console.error('Failed to login:', err);
});
