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
const allowedChannelId = config.chanId;

// Presale start date
const presaleStartDate = new Date('2024-11-11T00:00:00Z'); // Set the presale start date

// Define the target date for the countdown
const targetDate = new Date('2024-12-07T00:00:00Z'); // December 7, 0:00 UTC

// File path for persisting subscription data
const dataFilePath = path.join(__dirname + '/data/', 'subscriptionCodes.json');

const triviaData = JSON.parse(fs.readFileSync(path.join(__dirname + '/data/', 'trivia.json'), 'utf-8'));

// Check if triviaData is an array and retrieve questions
const triviaQuestions = triviaData[0]?.questions || [];
const triviaRoleName = triviaData[0]?.roleName || 'Default Role Name';
const triviaRoleColor = triviaData[0]?.roleColor || 9;
const triviaRolePoints = triviaData[0]?.rolePoints || 1; // Default to 1 if not specified
const userPoints = {}; // Track points per user

// Function to select a random trivia question
function getRandomTrivia() {
    if (triviaQuestions.length === 0) {
        return { question: 'No questions available', answer: '' };
    }
    const randomIndex = Math.floor(Math.random() * triviaQuestions.length);
    return triviaQuestions[randomIndex];
}

// In-memory storage for subscription codes, loaded from disk
let subscriptionCodes = loadSubscriptionCodes();


// Variables to store the current trivia question and answer for each user
const activeTrivia = {};

// Variable to track the last time a Twitter API call was made
let lastTwitterCallTime = 0;

// Ethers.js setup for interacting with the Ethereum network
const provider = new ethers.providers.JsonRpcProvider(config.rpcUrl); // Ethereum JSON-RPC provider URL
const contractAddress = config.contractAddress; // Address of the presale smart contract
const contractABI = config.contractABI; // ABI of the presale smart contract

const contract = new ethers.Contract(contractAddress, contractABI.abi, provider);

// Presale parameters
const hardCap = ethers.utils.parseEther('700'); // 700 ETH goal

// Define the date after which restricted commands can be used
const restrictionDate = new Date('2024-11-07T00:00:00Z'); // November 7, 0:00 UTC

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
        const progressPercentage = balance.mul(100).div(hardCap);
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

// Function to get the time left until the presale starts
function getTimeLeft() {
    const now = new Date();
    const diff = presaleStartDate - now;
    if (diff <= 0) {
        return 'The presale has already started!';
    }
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    return `Time left until the presale starts: ${days}d ${hours}h ${minutes}m ${seconds}s`;
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

    // Schedule the countdown to be sent to the #presale channel every 5 minutes
    // setInterval(async () => {
    //     const channel = client.channels.cache.get(config.chanId);
    //     if (channel) {
    //         channel.send(getTimeLeft());
    //     }
    // }, 60 * 60 * 1000); // 5 minutes in milliseconds    
});

// Function to assign a role to a user
async function assignRoleToUser(message, roleName) {
    // Find the role by name in the guild
    const role = message.guild.roles.cache.find(r => r.name === roleName);
    if (!role) {
        message.reply(`Role "${roleName}" not found.`);
        return;
    }

    // Find the member by the message author's ID
    const member = message.guild.members.cache.get(message.author.id);
    if (!member) {
        message.reply('Member not found.');
        return;
    }

    try {
        // Add the role to the member
        await member.roles.add(role);
        message.reply(`Role "${roleName}" has been assigned to you.`);
    } catch (error) {
        console.error('Error assigning role:', error);
        message.reply('There was an error assigning the role.');
    }
}

// Function to create a role if it doesn't exist
async function createRoleIfNotExists(guild, roleName) {
    let role = guild.roles.cache.find(r => r.name === roleName);
    if (!role) {
        try {
            role = await guild.roles.create({
                name: roleName,
                color: triviaRoleColor,
                reason: 'Role created by bot for trivia winners'
            });
            console.log(`Role "${roleName}" created successfully.`);
        } catch (error) {
            console.error('Error creating role:', error);
        }
    }
    return role;
}

// Function to assign the trivia role
async function assignTriviaRole(message) {
    const guild = message.guild;
    if (!guild) {
        message.reply('This command can only be used in a server.');
        return;
    }

    // Ensure the role exists or create it
    const role = await createRoleIfNotExists(guild, triviaRoleName);
    if (role) {
        try {
            const member = await guild.members.fetch(message.author.id);
            await member.roles.add(role);
            message.reply(`Congratulations! You've passed the trivia and been assigned the "${triviaRoleName}" role.`);
        } catch (error) {
            console.error('Error assigning trivia role:', error);
            message.reply('There was an error assigning the role.');
        }
    }
}

// Function to calculate time left
function getTimeLeftToTarget() {
    const now = new Date();
    const diff = targetDate - now;

    if (diff <= 0) {
        return 'The target date has already passed!';
    }

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    return `Time left until December 7, 0:00 UTC: ${days}d ${hours}h ${minutes}m ${seconds}s`;
}

// Function to check if restricted commands are available
function isAfterRestrictionDate() {
    const now = new Date();
    return now >= restrictionDate;
}

// Event listener for when a message is received
client.on('messageCreate', async (message) => {

    // Ignore messages from the bot itself
    if (message.author.bot) return;

    // Allow messages only in the allowed channel or in DMs
    if (message.guild && message.channel.id !== allowedChannelId) {
        console.log(`Ignored`);
        return;
    }

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
        1. **@BootstrapBot help** - Displays this help message. \n
        2. **@BootstrapBot subscribe @TwitterHandle 0xYourEthereumAddress** - (DM only)                                                   Subscribe with your Twitter handle and Ethereum address.\n
        3. **@BootstrapBot check servers** - (DM only)                                                                                                                    Checks if you have joined the specified servers.\n
        4. **@BootstrapBot verify** - (DM only)                                                                                                                                           Checks if your Twitter subscription has been verified.\n
        5. **@BootstrapBot task** - (DM only, daily)                                                                                                                                          Receive a daily task with a unique code to post on Twitter. Can only be used once per day.\n
        6. **@BootstrapBot verify task** - (DM only)                                                                                                                                          Verify that you have completed your daily task by posting the code on Twitter.
        `;
            message.reply(helpMessage);
            return;
        }
        
        // Handle the "task" command
        if (command === 'task') {
            if (!isAfterRestrictionDate()) {
                message.reply('This command will be available after November 7, 0:00 UTC.');
                return;
            }
            if (!message.guild) { // DM only
                // Check if the user already has a subscription
                let subscription = subscriptionCodes[userId];
                if (!subscription) {
                    message.reply('You need to subscribe first using `subscribe @TwitterHandle 0xYourEthereumAddress`.');
                    return;
                }
        
                // Check if the user has completed a task in the last 24 hours
                const now = Date.now();
                const oneDay = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
                if (subscription.lastTask && now - new Date(subscription.lastTask).getTime() < oneDay) {
                    message.reply('You can only complete one task per day. Please try again tomorrow.');
                    return;
                }
        
                // Generate a new unique code for the task
                const newTaskCode = generateUniqueCode();
                subscriptionCodes[userId].code = newTaskCode;
                subscriptionCodes[userId].verified = false; // Reset verification status
                subscriptionCodes[userId].lastTask = new Date().toISOString(); // Update lastTask to the current date and time
                message.reply(`Please post this text on X/Twitter to complete your task: \n
                    "I am participating in the Noma protocol bootstrap event. Unique code: ${newTaskCode}. Follow Noma on X/Twitter https://x.com/nomaprotocol and on Discord https://discord.gg/nomaprotocol"`);
                saveSubscriptionCodes();
                return;
            } else {
                message.reply('The "task" command can only be used in a direct message.');
            }
        }

    // Handle the "check servers" command (DM only)
    if (command === 'check servers') {
        if (!isAfterRestrictionDate()) {
            message.reply('This command will be available after November 7, 0:00 UTC.');
            return;
        }
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
    // if (command === 'check presale') {
    //     const progress = await checkPresaleProgress();
    //     if (progress) {
    //         message.reply(`Presale Progress:\nBalance: ${progress.balance} ETH\nProgress: ${progress.progressPercentage}%`);
    //     } else {
    //         message.reply('Failed to check presale progress.');
    //     }
    //     return;
    // }

    // Handle the "subscribe" command (DM only)
    if (command.startsWith('subscribe')) {
        if (!isAfterRestrictionDate()) {
            message.reply('This command will be available after November 7, 0:00 UTC.');
            return;
        }
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
            message.reply(`Please post this text on X/Twitter: \n
                "I am participating in the Noma protocol bootstrap event. Unique code: ${uniqueCode}. Follow Noma on X/Twitter https://x.com/nomaprotocol and on Discord https://discord.gg/nomaprotocol" \n\n
                 Once done, use the "@BootstrapBot verify" command to complete the process`);
    } else {
            message.reply('The "subscribe" command can only be used in a direct message.');
        }
        return;
    }

    // Handle the "verify" command (DM only)
    if (command === 'verify') {
        if (!isAfterRestrictionDate()) {
            message.reply('This command will be available after November 7, 0:00 UTC.');
            return;
        }
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
            message.reply('The "verify" command can only be used in a direct message.');
        }
        return;
    }

    // Handle the "verify task" command to check if the task is complete and update balance
    if (command === 'verify task') {
        if (!isAfterRestrictionDate()) {
            message.reply('This command will be available after November 7, 0:00 UTC.');
            return;
        }
        if (!message.guild) { // DM only
            const subscription = subscriptionCodes[userId];
            if (!subscription) {
                message.reply('Please subscribe and complete a task first.');
                return;
            }

            const { code, twitterHandle } = subscription;
            const isVerified = await checkTwitterPostForCode(twitterHandle, code);
            if (isVerified) {
                message.reply('Task verified successfully! Your balance has been increased by 1.');
                subscriptionCodes[userId].verified = true;
                subscriptionCodes[userId].balance = (subscriptionCodes[userId].balance || 0) + 1; // Increment balance
                saveSubscriptionCodes();
            } else {
                message.reply('Task verification failed. Please ensure you have posted the correct code on Twitter.');
            }
        } else {
            message.reply('The "verify task" command can only be used in a direct message.');
        }
        return;
    }

    // Handle the "add role" command
    // if (command.includes('add role')) {
    //     if (!message.guild) { // Check if the message is in a DM
    //         const roleName = command.slice('add role'.length).trim(); // Extract the role name from the command
    //         if (!roleName) {
    //             message.reply('Please specify a role name.');
    //             return;
    //         }
    //         // Assign the role to the user
    //         await assignRoleToUser(message, roleName);
    //         return;
    //     } else {
    //         message.reply('This command can only be used in a direct message.');
    //     }
    // }

    // Start the trivia
    // if (command === 'start trivia') {
    //     const trivia = getRandomTrivia();
    //     activeTrivia[userId] = trivia; // Store the question for this user
    //     message.reply(`Trivia Question: ${trivia.question}`);
    //     return;
    // }

    // Check if the user submitted an answer
    // if (command.startsWith('answer')) {
    //     const userAnswer = command.slice('answer'.length).trim().toLowerCase();
    //     const userTrivia = activeTrivia[userId];

    //     if (!userTrivia) {
    //         message.reply("Please start a trivia first by typing 'start trivia'.");
    //         return;
    //     }

    //     if (userAnswer === userTrivia.answer.toLowerCase()) {
    //         userPoints[userId] = (userPoints[userId] || 0) + 1; // Increment user points

    //         if (userPoints[userId] >= triviaRolePoints) {
    //             await assignTriviaRole(message); // Grant role if points meet requirement
    //             delete userPoints[userId]; // Reset user points
    //         } else {
    //             message.reply(`Correct! You need ${triviaRolePoints - userPoints[userId]} more points for the role.`);
    //         }

    //         delete activeTrivia[userId]; // Clear the trivia session for this user
    //     } else {
    //         message.reply("That's incorrect! Please try again.");
    //     }
    // }


    // Handle the "timeleft" command
    if (command === 'timeleft') {
        const timeLeftMessage = getTimeLeftToTarget();
        message.reply(timeLeftMessage);
        return;
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
        console.log(`Found on Twitter`)
    } catch (error) {
        console.error('Twitter check error:', error);
    }
    return false;
}

// Login to Discord
client.login(config.discordToken).catch(console.error);
