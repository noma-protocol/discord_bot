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

// Define the target date for the countdown
const targetDate = new Date('2024-12-07T00:00:00Z'); // December 7, 0:00 UTC

const taskCooldown = 86400; // Use 86400000 for a full 24 hours

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
        console.log('Saving subscription data:', JSON.stringify(subscriptionCodes, null, 2));
        if (Object.keys(subscriptionCodes).length > 0) {
            fs.writeFileSync(dataFilePath, JSON.stringify(subscriptionCodes, null, 2), { flag: 'w' });
            console.log('Subscription data saved successfully.');

            // Immediately read and log the file contents for verification
            const savedData = fs.readFileSync(dataFilePath, 'utf-8');
            console.log('Verified saved data:', savedData);
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

// Function to get the latest tweet ID from the target account
async function getLatestTweetId(twitterHandle) {
    try {
        const user = await twitterClient.v2.userByUsername(twitterHandle);
        if (!user) return null;

        const { data } = await twitterClient.v2.userTimeline(user.data.id, { max_results: 5 });
        if (data && data.data && data.data.length > 0) {
            return data.data[0].id; // Return the latest tweet ID
        }
    } catch (error) {
        console.error('Error fetching latest tweet:', error);
    }
    return null;
}

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
            console.log(`Found on Twitter`)
            return tweets._realData.data.some(tweet => tweet.text.includes(code));
        }
    } catch (error) {
        console.error('Twitter check error:', error);
    }
    return false;
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
    return true; // now >= restrictionDate;
}

// Helper function to parse commands, including multi-word commands
function parseCommand(messageContent, botMention) {
    const commandString = messageContent.replace(botMention, '').trim();
    const commandMatch = commandString.match(/(\w+\s*\w*)(.*)/); // Capture up to two words for the command
    if (!commandMatch) return { command: null, args: [] };

    const [, command, argsString] = commandMatch;
    const args = argsString.trim().split(/\s+/); // Split arguments by spaces, removing any excess whitespace

    return { command: command.toLowerCase(), args };
}

client.on('messageCreate', async (message) => {
    if (message.author.bot) return; // Ignore bot messages
    if (message.guild && message.channel.id !== allowedChannelId) return; // Allow only in allowed channel or DM

    const userId = message.author.id;
    const botMention = `<@${client.user.id}>`;
    const messageContent = message.content.trim();

    if (messageContent.startsWith(botMention)) {
        const { command, args } = parseCommand(messageContent, botMention);

        if (!command) return;

        // Handle commands flexibly without worrying about whitespace
        switch (command) {
            case 'help':
                const helpMessage = `
                    **Available Commands:**
                    1. **@BootstrapBot help** - Displays this help message. \n
                    2. **@BootstrapBot subscribe @TwitterHandle 0xYourEthereumAddress** - (DM only) Subscribe with your Twitter handle and Ethereum address.\n
                    3. **@BootstrapBot finalize** - (DM only) Check if you posted your text on X/Twitter to finalize your subscription.\n
                    4. **@BootstrapBot balance** - Check your $NOMA points balance.\n
                    5. **@BootstrapBot task** - (DM only) Receive a daily task with a unique code to post on X/Twitter. Can only be used once per day.\n
                    6. **@BootstrapBot verify task** - (DM only) Verify that you have completed your daily task by posting the code on X/Twitter. Can only be used once per day.
                `;
                message.reply(helpMessage);
                break;

            case 'balance':
                const subscription = subscriptionCodes[userId];
                const balanceMessage = subscription && subscription.balance
                    ? `Your current balance is ${subscription.balance} $NOMA points.`
                    : "You don't have any $NOMA points yet. Start participating to earn points!";
                message.reply(balanceMessage);
                break;

            case 'subscribe':
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
                    subscriptionCodes[userId] = { code: uniqueCode, twitterHandle, verified: false, balance: 0, lastTask: null, address: ethereumAddress };
        
                    saveSubscriptionCodes();
                    message.reply(`Please post this text on X/Twitter: \n
                        "I want to be whitelisted for the Noma protocol bootstrap event. Unique code: ${uniqueCode}. Follow Noma on X/Twitter x.com/nomaprotocol and join the Discord community discord.gg/nomaprotocol #Base #Ethereum #DeFi $NOMA" \n \n
                         Once done, use the "@BootstrapBot finalize" command to complete the process`);
                } else {
                        message.reply('The "subscribe" command can only be used in a direct message.');
                }
                break;

            case 'task':
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
        
                    const now = Date.now();
        
                    // Check if the user has completed a task recently
                    if (subscription.lastTask) {
                        console.log(`Last task time for user: ${subscription.lastTask}`);
                        const timeSinceLastTask = now - new Date(subscription.lastTask).getTime();
                        console.log(`Time since last task (ms): ${timeSinceLastTask}`);
                        
                        if (timeSinceLastTask < taskCooldown) { // Reduced for testing
                            message.reply('You can only complete one task per day. Please try again tomorrow.');
                            return;
                        }
                    } else {
                        console.log('No last task found, allowing task generation.');
                    }
        
                    // Generate a new unique code for the task
                    const newTaskCode = generateUniqueCode();
                    subscriptionCodes[userId].code = newTaskCode;
                    subscriptionCodes[userId].lastTask = new Date().toISOString(); // Update lastTask to the current date and time
                    message.reply(`Please post this text on X/Twitter to complete your task: \n
                        "I am participating in the Noma protocol bootstrap event. Unique code: ${newTaskCode}. Follow Noma on X/Twitter x.com/nomaprotocol and join the Discord community discord.gg/nomaprotocol #Base #Ethereum #DeFi $NOMA" \n\n
                        Once done, use the "@BootstrapBot verify task" command to complete the process`);
                    saveSubscriptionCodes();
                    console.log(`Task generated for user ${userId} with code ${newTaskCode}`);
                    return;
                } else {
                    message.reply('The "task" command can only be used in a direct message.');
                }
                break;

            case 'finalize':
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
                break;

            case 'verify task':
                if (!isAfterRestrictionDate()) {
                    message.reply('This command will be available after November 7, 0:00 UTC.');
                    return;
                }
                if (!message.guild) { // DM only
                    const subscription = subscriptionCodes[userId];
                    if (!subscription) {
                        message.reply('Please subscribe first.');
                        return;
                    }
                    
                    const now = Date.now();
                    try {
                        const { code, twitterHandle } = subscription;
                        
                        // Check if the user has completed a task recently
                        if (subscription.lastTask) {
                            console.log(`Last task time for user: ${subscription.lastTask}`);
                            const timeSinceLastTask = now - new Date(subscription.lastTask).getTime();
                            console.log(`Time since last task (ms): ${timeSinceLastTask}`);
                            
                            if (timeSinceLastTask < taskCooldown) { // Reduced for testing
                                message.reply('You can only complete one task per day. Please try again tomorrow.');
                                return;
                            }
                        }
                        const isVerified = await checkTwitterPostForCode(twitterHandle, code);
                        
                        if (isVerified) {
                            message.reply('Verified successfully.');
                            subscription.lastTask = now;
                            subscription.balance = (subscription.balance || 0) + 1;
        
                            saveSubscriptionCodes();
                        } else {
                            message.reply('Verification failed.');
                        }
                      } catch (e) {
                        console.log(e);
                        process.exit(-1);
                      }
        
        
                } else {
                    message.reply('The "verify task" command can only be used in a direct message.');
                }  
                break;

            // Handle other commands here, like "subscribe", "check servers", etc.
            default:
                message.reply(`Unknown command "${command}". Type "@BootstrapBot help" to see available commands.`);
        }
    }
});


// Login to Discord
client.login(config.discordToken).catch(console.error);
