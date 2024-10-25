const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { TwitterApi } = require('twitter-api-v2');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers'); // Import ethers.js for Ethereum interaction

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
const dataFilePath = path.join(__dirname + 'data/', 'subscriptionCodes.json');

// In-memory storage for subscription codes, loaded from disk
let subscriptionCodes = loadSubscriptionCodes();

// Variable to track the last time a Twitter API call was made
let lastTwitterCallTime = 0;

// Ethers.js setup for interacting with the Ethereum network
const provider = new ethers.providers.JsonRpcProvider(config.rpcUrl); // Ethereum JSON-RPC provider URL
const contractAddress = config.contractAddress; // Address of the presale smart contract
const contractABI = config.contractABI; // ABI of the presale smart contract

const contract = new ethers.Contract(contractAddress, contractABI.abi, provider);

// Presale parameters
const totalGoal = ethers.utils.parseEther('700'); // 700 ETH goal
const minParticipation = ethers.utils.parseEther('0.25'); // Minimum participation 0.25 ETH
const maxParticipation = ethers.utils.parseEther('10'); // Maximum participation 10 ETH

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

// Function to check the presale progress
async function checkPresaleProgress() {
    try {
        const balance = await provider.getBalance(contractAddress);
        const progressPercentage = balance.mul(100).div(totalGoal);
        return {
            balance: ethers.utils.formatEther(balance),
            progressPercentage: progressPercentage.toString()
        };
    } catch (error) {
        console.error('Error checking presale progress:', error);
        return null;
    }
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
    const botMention = `<@${client.user.id}>`; // The bot's mention format
    const messageContent = message.content.trim();

    console.log(`Processing message from user ${userId}`);

    // Check if the message starts with the bot's mention
    if (messageContent.startsWith(botMention)) {
        // Remove the bot mention from the message content
        const command = messageContent.slice(botMention.length).trim().toLowerCase();

        // Handle the "help" command
        if (command === 'help') {
            const helpMessage = `
**Available Commands:**
1. **help** - Displays this help message.
2. **check servers** - (DM only) Checks if you have joined the specified servers.
3. **check presale** - Shows the current progress of the presale.
4. **subscribe @TwitterHandle 0xYourEthereumAddress** - (DM only) Subscribe with your Twitter handle and Ethereum address.
5. **check twitter** - (DM only) Check if your Twitter subscription has been verified.
            `;
            message.reply(helpMessage);
            return;
        }

        // Handle the "check servers" command (DM only)
        if (command === 'check servers') {
            if (!message.guild) { // Check if the message is in a DM
                const memberStatus = await isUserMemberOfServers(userId);
                const response = Object.entries(memberStatus)
                    .map(([serverId, isMember]) => `Server ${serverId}: ${isMember ? 'Joined' : 'Not Joined'}`)
                    .join('\n');
                message.reply(`Server membership status:\n${response}`);
            } else {
                message.reply('The "check servers" command can only be used in a direct message.');
            }
            return;
        }

        // Handle the "check presale" command (can be used in channels)
        if (command === 'check presale') {
            const progress = await checkPresaleProgress();
            if (progress) {
                message.reply(`Presale Progress:\nBalance: ${progress.balance} ETH\nProgress: ${progress.progressPercentage}%`);
            } else {
                message.reply('Failed to check presale progress.');
            }
            return;
        }

        // Handle the "subscribe" command (DM only)
        if (command.startsWith('subscribe')) {
            if (!message.guild) { // Check if the message is in a DM
                console.log(`User ${userId} wants to subscribe with message: ${message.content}`);
                if (subscriptionCodes[userId]) {
                    message.reply('You are already registered.');
                    return;
                }

                const args = command.split(' ');
                if (args.length < 3 || !args[1].startsWith('@') || !ethers.utils.isAddress(args[2])) {
                    message.reply('Usage: subscribe @TwitterHandle 0xYourEthereumAddress');
                    return;
                }

                const twitterHandle = args[1].replace('@', '').trim();
                const ethereumAddress = args[2].trim();

                if (!/^[A-Za-z0-9_]{1,15}$/.test(twitterHandle)) {
                    message.reply('Invalid Twitter handle.');
                    return;
                }

                if (isAddressAlreadyRegistered(ethereumAddress)) {
                    message.reply('This Ethereum address is already registered.');
                    return;
                }

                const uniqueCode = generateUniqueCode();
                subscriptionCodes[userId] = { code: uniqueCode, twitterHandle, verified: false, address: ethereumAddress };

                saveSubscriptionCodes();
                message.reply(`Please post this code on Twitter: ${uniqueCode}`);
            } else {
                message.reply('The "subscribe" command can only be used in a direct message.');
            }
            return;
        }

        // Handle "check twitter" command (DM only)
        if (command.includes('check twitter')) {
            if (!message.guild) { // Check if the message is in a DM
                const subscription = subscriptionCodes[userId];
                if (!subscription) {
                    message.reply('Please subscribe first.');
                    return;
                }

                if (subscription.verified) {
                    message.reply('You are already verified.');
                    return;
                }

                const { code, twitterHandle } = subscription;
                const isVerified = await checkTwitterPostForCode(twitterHandle, code);
                if (isVerified) {
                    message.reply('Verified successfully.');
                    subscriptionCodes[userId].verified = true;
                    saveSubscriptionCodes();
                } else {
                    message.reply('Verification failed.');
                }
            } else {
                message.reply('The "check twitter" command can only be used in a direct message.');
            }
        } else {
            // If the command is unrecognized, reply with a default message
            message.reply('Unknown command. Type "help" for a list of available commands.');
        }
    }
});


// Function to check if the user's Twitter account has posted the code
async function checkTwitterPostForCode(twitterHandle, code) {
    console.log(`Checking Twitter for code ${code}`);
    const now = Date.now();
    if (now - lastTwitterCallTime < 10000) {
        console.log('Throttling API requests.');
        return false;
    }
    lastTwitterCallTime = now;

    try {
        const user = await twitterClient.v2.userByUsername(twitterHandle);
        if (!user) {
            console.log(`User not found: @${twitterHandle}`);
            return false;
        }

        const tweets = await twitterClient.v2.search(`from:${twitterHandle} ${code}`, { 'tweet.fields': 'author_id' });
        if (tweets._realData && tweets._realData.data) {
            return tweets._realData.data.some(tweet => tweet.text.includes(code));
        }
    } catch (error) {
        console.error('Twitter check error:', error);
    }
    return false;
}

// Login to Discord
client.login(config.discordToken).catch(console.error);
