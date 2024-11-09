// index.js

const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { TwitterApi } = require('twitter-api-v2');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers'); // Import ethers.js for Ethereum interaction

// Load configuration from config.js
const config = require('./config');

// Import command handlers from cmd.js
const { handleFinalizeCommand, handleSubscribeCommand, handleTaskCommand, handleVerifyTaskCommand } = require("./cmd");

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

const taskCooldown = config.taskCooldown; 
// Initialize a variable to track the last Twitter API call time for throttling
let lastTwitterCallTime = 0;

// File path for persisting subscription data
const dataFilePath = path.join(__dirname, 'data', 'subscriptionCodes.json');

// Ensure the /data/ directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)){
    fs.mkdirSync(dataDir, { recursive: true });
    console.log('Created /data/ directory.');
}

// Load trivia data
let triviaData = {};
try {
    const triviaRaw = fs.readFileSync(path.join(__dirname, 'data', 'trivia.json'), 'utf-8');
    triviaData = JSON.parse(triviaRaw);
} catch (error) {
    console.error('Error loading trivia data:', error);
}

// Extract trivia details
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

/**
 * Function to load subscription codes from a JSON file.
 * @returns {Object} - The subscription codes object.
 */
function loadSubscriptionCodes() {
    if (fs.existsSync(dataFilePath)) {
        const data = fs.readFileSync(dataFilePath, 'utf-8');
        return JSON.parse(data);
    }
    return {};
}

/**
 * Function to save subscription codes to a JSON file.
 */
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

/**
 * Function to generate a unique subscription code.
 * @returns {string} - An 8-character hexadecimal code.
 */
function generateUniqueCode() {
    return crypto.randomBytes(4).toString('hex'); // Generates an 8-character hex code
}

/**
 * Function to check if a user is a member of specified servers.
 * @param {string} userId - The Discord user ID.
 * @returns {Object} - An object with server IDs as keys and membership status as values.
 */
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

/**
 * Function to check the presale progress.
 * @returns {Object|null} - An object containing balance and progressPercentage or null if an error occurs.
 */
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

/**
 * Function to check if an Ethereum address is already registered.
 * @param {string} address - The Ethereum address to check.
 * @returns {boolean} - Returns true if the address is already registered.
 */
function isAddressAlreadyRegistered(address) {
    return Object.values(subscriptionCodes).some(subscription => 
        typeof subscription.address === 'string' && 
        subscription.address.toLowerCase() === address.toLowerCase()
    );
}


/**
 * Function to assign a role to a user.
 * @param {Message} message - The Discord message object.
 * @param {string} roleName - The name of the role to assign.
 */
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

/**
 * Function to create a role if it doesn't exist.
 * @param {Guild} guild - The Discord guild (server) object.
 * @param {string} roleName - The name of the role to create.
 * @returns {Role|null} - The created role or null if an error occurs.
 */
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

/**
 * Function to assign the trivia role to a user.
 * @param {Message} message - The Discord message object.
 */
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

/**
 * Function to calculate the time left until the target date.
 * @returns {string} - A formatted string indicating the time left.
 */
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

/**
 * Function to check if the current date is after the restriction date.
 * @returns {boolean} - Returns true if current date is after restriction date.
 */
function isAfterRestrictionDate() {
    const now = new Date();
    const restrictionDate = new Date(config.restrictionDate);
    return now >= restrictionDate;
}

// Ethers.js setup for interacting with the Ethereum network
const provider = new ethers.providers.JsonRpcProvider(config.rpcUrl); // Ethereum JSON-RPC provider URL
const contractAddress = config.contractAddress; // Address of the presale smart contract
const contractABI = config.contractABI; // ABI of the presale smart contract

const contract = new ethers.Contract(contractAddress, contractABI.abi, provider);

// Presale parameters
const hardCap = ethers.utils.parseEther('700'); // 700 ETH goal

// Event listener for when the client is ready
client.once('ready', async () => {
    console.log('Logged in as ' + client.user.tag);
    try {
        await client.user.setPresence({ status: 'online' });
        console.log('Status set to online');
    } catch (error) {
        console.error('Failed to set status:', error);
    }

    // Schedule the countdown to be sent to the #presale channel every hour
    // Uncomment the following lines if you wish to enable the countdown feature
    /*
    setInterval(async () => {
        const channel = client.channels.cache.get(config.chanId);
        if (channel) {
            channel.send(getTimeLeftToTarget());
        }
    }, 60 * 60 * 1000); // 1 hour in milliseconds
    */
});

// Event listener for messageCreate with improved parsing and logging
client.on('messageCreate', async (message) => {
    if (message.author.bot) return; // Ignore bot messages
    if (message.guild && message.channel.id !== allowedChannelId) return; // Allow only in allowed channel or DM

    const userId = message.author.id;

    // Regular expression to match both <@ID> and <@!ID>
    const mentionRegex = /^<@!?(\d+)>/;
    const matches = message.content.match(mentionRegex);

    if (!matches) return; // Bot not mentioned

    // Extract the command string by removing the mention
    const commandString = message.content.replace(matches[0], '').trim();

    // Split the command string into command and args
    const args = commandString.split(/\s+/);
    const command = args.shift()?.toLowerCase();

    // Log the parsed command and arguments
    console.log(`User ${userId} invoked command: "${command}" with args: ${args}`);

    if (!command) {
        message.reply(`No command detected. Type "@BootstrapBot help" to see available commands.`);
        return;
    }

    const context = {
        subscriptionCodes,
        saveSubscriptionCodes,
        generateUniqueCode,
        isAddressAlreadyRegistered,
        isAfterRestrictionDate,
        checkTwitterPostForCode,
        taskCooldown: config.taskCooldown,
        lastTwitterCallTime // Add lastTwitterCallTime here
    };

    switch (command) {
        case 'help':
            const helpMessage = `
**Available Commands:**
1. **@BootstrapBot help** - Displays this help message.
2. **@BootstrapBot subscribe @TwitterHandle 0xYourEthereumAddress** - (DM only) Subscribe with your Twitter handle and Ethereum address.
3. **@BootstrapBot finalize** - (DM only) Check if you posted your text on X/Twitter to finalize your subscription.
4. **@BootstrapBot balance** - Check your $NOMA points balance.
5. **@BootstrapBot task** - (DM only) Receive a daily task with a unique code to post on X/Twitter. Can only be used once per day.
6. **@BootstrapBot verify task** - (DM only) Verify that you have completed your daily task by posting the code on X/Twitter.
`;
            message.reply(helpMessage);
            console.log(`Sent help message to user ${userId}.`);
            break;

        case 'balance':
            const subscription = subscriptionCodes[userId];
            const balanceMessage = subscription && subscription.balance
                ? `Your current balance is ${subscription.balance} $NOMA points.`
                : "You don't have any $NOMA points yet. Start participating to earn points!";
            message.reply(balanceMessage);
            break;

        case 'subscribe':
            // Call the handleSubscribeCommand from cmd.js
            await handleSubscribeCommand(message, args, context);
            break;

        case 'finalize':
            // Call the handleFinalizeCommand from cmd.js
            await handleFinalizeCommand(message, args, context);
            break;

        case 'task':
            await handleTaskCommand(message, args, context);
            break;
        case 'verify':
            if (args[0]?.toLowerCase() === 'task') {
                await handleVerifyTaskCommand(message, args.slice(1), context);
            } else {
                message.reply(`Unknown command "verify ${args[0] || ''}". Did you mean "verify task"?`);
            }
            break;

        default:
            message.reply(`Unknown command "${command}". Type "@BootstrapBot help" to see available commands.`);
            console.log(`Unknown command "${command}" invoked by user ${userId}.`);
    }
});

/**
 * Function to check if the user's Twitter account has posted the unique code.
 * This function is passed to the finalize command handler.
 * @param {string} twitterHandle - The user's Twitter handle.
 * @param {string} code - The unique subscription code.
 * @returns {boolean} - Returns true if the code is found in the user's recent tweets.
 */
async function checkTwitterPostForCode(twitterHandle, code) {
    console.log(`Checking Twitter for code: ${code}`);
    const now = Date.now();

    // Throttle Twitter API calls to prevent rate limiting (10 seconds cooldown)
    if (now - lastTwitterCallTime < 10000) {
        console.log('Throttling Twitter API requests.');
        return false;
    }
    lastTwitterCallTime = now;

    try {
        const user = await twitterClient.v2.userByUsername(twitterHandle);
        if (!user) {
            console.log(`User not found: @${twitterHandle}`);
            return false;
        }

        const tweets = await twitterClient.v2.userTimeline(user.data.id, { max_results: 5 });

        console.log(tweets._realData.data)

        if (tweets._realData.data && tweets._realData.data.length > 0) {
            console.log(`Found tweets for @${twitterHandle}.`);
            return tweets._realData.data.some(tweet => tweet.text.includes(code));
        } else {
            console.log(`No recent tweets found for @${twitterHandle}.`);
            return false;
        }
    } catch (error) {
        console.error('Error fetching tweets:', error);
        return false;
    }
}

// Login to Discord
client.login(config.discordToken).catch(console.error);
