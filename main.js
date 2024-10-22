const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { TwitterApi } = require('twitter-api-v2');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers'); // Import ethers.js for Ethereum address validation

// Load configuration from config.js
const config = require('./config');

// Initialize a new Discord client with necessary intents and partials
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent, 
        GatewayIntentBits.DirectMessages 
    ],
    partials: [Partials.Channel]
});

// Twitter API credentials from the configuration
const twitterClient = new TwitterApi({
    appKey: config.twitterApi.appKey,
    appSecret: config.twitterApi.appSecret,
    accessToken: config.twitterApi.accessToken,
    accessSecret: config.twitterApi.accessSecret
});

// List of server IDs to check for membership
const serverIDs = config.serverIDs;

// File path for persisting subscription data
const dataFilePath = path.join(__dirname, 'subscriptionCodes.json');

// In-memory storage for subscription codes, loaded from disk
let subscriptionCodes = loadSubscriptionCodes();

// Variable to track the last time a Twitter API call was made
let lastTwitterCallTime = 0;

// Function to load subscription codes from a JSON file
function loadSubscriptionCodes() {
    if (fs.existsSync(dataFilePath)) {
        const data = fs.readFileSync(dataFilePath, 'utf-8');
        return JSON.parse(data);
    }
    return {};
}

// Function to save subscription codes to a JSON file
function saveSubscriptionCodes() {
    try {
        if (Object.keys(subscriptionCodes).length > 0) {
            fs.writeFileSync(dataFilePath, JSON.stringify(subscriptionCodes, null, 2));
            console.log('Subscription data saved successfully.');
        } else {
            console.log('No subscriptions to save.');
            if (fs.existsSync(dataFilePath)) {
                fs.unlinkSync(dataFilePath);
                console.log('Subscription file deleted.');
            }
        }
    } catch (error) {
        console.error('Error saving subscription codes:', error);
    }
}

// Function to generate a unique code
function generateUniqueCode() {
    return crypto.randomBytes(4).toString('hex'); // Generates an 8-character hex code
}

// Function to check if the user is a member of the specified servers
async function isUserMemberOfServers(userId) {
    const memberStatus = {};
    for (const serverId of serverIDs) {
        const guild = client.guilds.cache.get(serverId);
        if (guild) {
            const member = await guild.members.fetch(userId).catch(() => null);
            memberStatus[serverId] = member ? true : false;
        } else {
            memberStatus[serverId] = false;
        }
    }
    return memberStatus;
}

// Function to check if an Ethereum address is already registered
function isAddressAlreadyRegistered(address) {
    return Object.values(subscriptionCodes).some(subscription => subscription.address.toLowerCase() === address.toLowerCase());
}

// Event listener for when the client is ready
client.once('ready', async () => {
    console.log('Logged in as ' + client.user.tag);
    try {
        await client.user.setPresence({ status: 'online' });
        console.log('Status set to online');
    } catch (error) {
        console.error('Failed to set status:', error);
    }
});

// Event listener for when a message is received
client.on('messageCreate', async (message) => {
    // Ignore messages from the bot itself
    if (message.author.bot) return;

    const userId = message.author.id;
    console.log(`Processing message from user ${userId}`);

    // Handle the "check servers" command
    if (message.content.toLowerCase() === 'check servers') {
        const memberStatus = await isUserMemberOfServers(userId);
        const response = Object.entries(memberStatus)
            .map(([serverId, isMember]) => `Server ${serverId}: ${isMember ? 'Joined' : 'Not Joined'}`)
            .join('\n');
        message.reply(`Server membership status:\n${response}`);
        return;
    }

    // Check if the message contains the word "subscribe" along with a Twitter handle and Ethereum address
    if (message.content.toLowerCase().startsWith('subscribe')) {
        console.log(`User ${userId} wants to subscribe with message: ${message.content}`);
        // Check if the user is already registered
        if (subscriptionCodes[userId]) {
            message.reply('You are already registered with a Twitter handle.');
            return;
        }

        const args = message.content.split(' ');
        if (args.length < 3 || !args[1].startsWith('@') || !ethers.utils.isAddress(args[2])) {
            message.reply('Please provide your Twitter handle and a valid Ethereum address. Usage: "subscribe @TwitterHandle 0xYourEthereumAddress"');
            return;
        }

        const twitterHandle = args[1].replace('@', '').trim();
        const ethereumAddress = args[2].trim();

        if (!/^[A-Za-z0-9_]{1,15}$/.test(twitterHandle)) {
            message.reply('Invalid Twitter handle format. Twitter handles can only contain letters, numbers, and underscores, and must be 1-15 characters long.');
            return;
        }

        // Check if the Ethereum address is already registered
        if (isAddressAlreadyRegistered(ethereumAddress)) {
            message.reply('This Ethereum address is already registered. Please use a different address.');
            return;
        }

        // Generate a unique code for the user
        const uniqueCode = generateUniqueCode();
        subscriptionCodes[userId] = { 
            code: uniqueCode, 
            twitterHandle, 
            verified: false, 
            address: ethereumAddress 
        };

        // Save the updated subscription data to disk
        saveSubscriptionCodes();

        // Send the code to the user
        message.reply(`To complete your subscription, please post this code on your Twitter account: ${uniqueCode}`);
        return;
    }

    // Handle checking if the user is subscribed
    if (message.content.toLowerCase().includes('check twitter')) {
        // Verify if the user has posted the code on Twitter
        const subscription = subscriptionCodes[userId];
        if (!subscription) {
            console.log(`No subscription found for user: ${userId}`);
            message.reply('No subscription code found. Please subscribe first.');
            return;
        }

        // If the user is already verified, no need to check Twitter
        if (subscription.verified) {
            message.reply('You are already verified.');
            return;
        }

        const { code, twitterHandle } = subscription;

        // Check Twitter for the user's tweet containing the code
        const isVerified = await checkTwitterPostForCode(twitterHandle, code);
        if (isVerified) {
            message.reply('Subscription verified! You have successfully posted the code on Twitter.');
            // Mark the subscription as verified
            subscriptionCodes[userId].verified = true;
            saveSubscriptionCodes();
        } else {
            message.reply('We could not find a Twitter post containing the code. Please try again.');
        }
    }
});

// Function to check if the user's Twitter account has posted the code
async function checkTwitterPostForCode(twitterHandle, code) {
    console.log(`Checking Twitter for code ${code}`);
    const now = Date.now();
    if (now - lastTwitterCallTime < 10000) { // 10 seconds throttling
        console.log('Throttling: Please wait before making another Twitter API call.');
        return false;
    }
    lastTwitterCallTime = now; // Update the last call time

    try {
        // Search for the latest tweets from the specified Twitter handle containing the code
        const user = await twitterClient.v2.userByUsername(twitterHandle);
        if (!user) {
            console.log(`Twitter user @${twitterHandle} not found.`);
            return false;
        }

        const tweets = await twitterClient.v2.search(`from:${twitterHandle} ${code}`, { 'tweet.fields': 'author_id' });

        // Access the tweets data correctly
        if (tweets._realData && tweets._realData.data) {
            for (const tweet of tweets._realData.data) {
                if (tweet.text.includes(code)) {
                    console.log(`User @${twitterHandle} has posted the code on Twitter.`);
                    return true;
                }
            }
        } else {
            console.log(`No tweets found for user @${twitterHandle} containing the code ${code}.`);
        }
    } catch (error) {
        console.error('Error checking Twitter for the code:', error);
    }

    return false;
}

// Login to Discord
client.login(config.discordToken).catch((err) => {
    console.error('Failed to login:', err);
});
