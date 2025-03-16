const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { TwitterApi } = require('twitter-api-v2');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers'); // Import ethers.js for Ethereum interaction

const natural = require('natural');
const wordnet = new natural.WordNet(); // WordNet for synonyms
const { handleSubscribeCommand } = require("./cmd");

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

const triviaTopics = {
    "1": "Cryptography",
    "2": "Web Design",
    "3": "Network Security",
    "4": "Blockchain",
    "5": "Programming",
    "6": "AI"
};

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

/**
 * Handles the 'trivia' command, allowing users to select a topic by number.
 * Matches the topic string to a roleName in trivia.json dynamically.
 * @param {Message} message - The Discord message object.
 */
async function handleTriviaCommand(message) {
    // Number emoji list (supports up to 10 topics)
    const numberEmojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

    // Create a numbered list of topics dynamically from trivia.json
    const availableTopics = triviaData.map((topic, index) => `${numberEmojis[index]} **${topic.roleName}**`);

    // Send menu to user with emojis
    message.reply(
        `📚 **Choose a Trivia Category:**\n` +
        availableTopics.join('\n') + `\n\n` +
        `✏️ Reply with the number of your choice!`
    );
    // Wait for the user's response
    const filter = response => response.author.id === message.author.id;
    const collector = message.channel.createMessageCollector({ filter, time: 30000 });

    collector.on('collect', response => {
        const choiceIndex = parseInt(response.content.trim(), 10) - 1; // Convert user input (1,2,3) to array index (0,1,2)
        
        if (isNaN(choiceIndex) || choiceIndex < 0 || choiceIndex >= triviaData.length) {
            message.reply("❌ Invalid choice. Please enter a valid number.");
            return;
        }

        const selectedTopic = triviaData[choiceIndex]; // Get the corresponding topic
        const topicQuestions = selectedTopic.questions;

        if (!topicQuestions || topicQuestions.length === 0) {
            message.reply(`❌ No questions available for **${selectedTopic.roleName}**.`);
            return;
        }

        // Pick a random question from the selected topic
        const randomQuestion = topicQuestions[Math.floor(Math.random() * topicQuestions.length)];

        message.reply(`📢 **${selectedTopic.roleName} Trivia:**\n🔹 ${randomQuestion.question}\n\nReply within **30 seconds**!`);

        collector.stop();

        // Listen for the user's answer
        const answerCollector = message.channel.createMessageCollector({ filter, time: 30000 });

        answerCollector.on('collect', async answer => {
            if (await isAnswerCorrect(answer.content, randomQuestion.answer)) {
                message.reply(`🎉 Correct! You earned **${selectedTopic.rolePoints} points**.`);
                addPointsToUser(message.author.id, selectedTopic.rolePoints);
                assignTriviaRole(message);
            } else {
                message.reply(`❌ Incorrect! The correct answer was **${randomQuestion.answer}**.`);
            }
            answerCollector.stop();
        });

        answerCollector.on('end', collected => {
            if (collected.size === 0) {
                message.reply('⏳ Time is up! Better luck next time.');
            }
        });
    });

    collector.on('end', collected => {
        if (collected.size === 0) {
            message.reply("⏳ You didn't select a category in time. Try again!");
        }
    });
}

/**
 * Function to check if a user's answer is correct with leniency.
 * Uses WordNet to match synonyms.
 * @param {string} userAnswer - The answer provided by the user.
 * @param {string} correctAnswer - The expected correct answer.
 * @returns {Promise<boolean>} - Returns true if the answer is considered correct.
 */
async function isAnswerCorrect(userAnswer, correctAnswer) {
    const normalize = (text) => 
        text.toLowerCase()
            .replace(/[^\w\s]/g, '')  // Remove punctuation
            .trim()
            .split(/\s+/);            // Split into words

    const userWords = new Set(normalize(userAnswer));
    const correctWords = new Set(normalize(correctAnswer));

    // Calculate intersection of words
    const commonWords = [...userWords].filter(word => correctWords.has(word)).length;

    // If direct match (50% threshold), accept it
    const accuracyThreshold = Math.ceil(correctWords.size * 0.5); 
    if (commonWords >= accuracyThreshold) return true;

    // Check for synonyms if direct match fails
    for (let word of userWords) {
        const synonyms = await getSynonyms(word);
        for (let correctWord of correctWords) {
            if (synonyms.has(correctWord)) {
                console.log(`Matched synonym: ${word} → ${correctWord}`);
                return true;
            }
        }
    }

    return false;
}

/**
 * Fetch synonyms for a given word using WordNet.
 * @param {string} word - The word to look up.
 * @returns {Promise<Set<string>>} - A set of synonyms for the word.
 */
async function getSynonyms(word) {
    return new Promise((resolve) => {
        wordnet.lookup(word, (results) => {
            const synonyms = new Set();
            results.forEach((result) => {
                result.synonyms.forEach((syn) => synonyms.add(syn.toLowerCase()));
            });
            resolve(synonyms);
        });
    });
}

function addPointsToUser(userId, points) {

    const subscription = subscriptionCodes[userId];
    subscription.triviaBalance = (subscription.triviaBalance || 0) + points; 
    
    saveSubscriptionCodes();
}


client.on('messageCreate', async (message) => {
    if (message.author.bot) return; // Ignore bot messages

    // Ensure the message is from the allowed channel or a DM
    if (message.guild && message.channel.id !== allowedChannelId) {
        return;
    }

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
        lastTwitterCallTime
    };

    // **Check if user is subscribed before allowing access to certain commands**
    if (!subscriptionCodes[userId] && !['help', 'subscribe'].includes(command)) {
        message.reply(`⚠️ You are not subscribed! Use **@BootstrapBot subscribe @TwitterHandle 0xYourEthereumAddress** to register.`);
        return;
    }

    switch (command) {
        case 'help':
            const helpMessage = `
                **Available Commands:**
                1. **@BootstrapBot help** - Displays this help message.
                2. **@BootstrapBot subscribe @TwitterHandle 0xYourEthereumAddress** - Subscribe with your Twitter handle and Ethereum address.
                3. **@BootstrapBot trivia** - Get a random trivia question to answer for points.
                4. **@BootstrapBot balance** - Check your $NOMA points balance.
            `;
            
            message.reply(helpMessage);
            console.log(`Sent help message to user ${userId}.`);
            break;

        case 'balance':
            const subscription = subscriptionCodes[userId];
            const nomaBalance = subscription && subscription.balance
                ? `Your $NOMA balance: **${subscription.balance} points**`
                : "You don't have any $NOMA points yet.";

            const triviaBalance = subscription && subscription.triviaBalance
                ? `Your Trivia balance: **${subscription.triviaBalance} points**`
                : "You haven't earned any trivia points yet.";

            const balanceMessage = `${nomaBalance}\n${triviaBalance}`;
            
            message.reply(balanceMessage);
            break;
    
        case 'subscribe':
            await handleSubscribeCommand(message, args, context);
            break;

        case 'finalize':
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

        case 'trivia':
            await handleTriviaCommand(message);
            break;

        default:
            message.reply(`Unknown command "${command}". Type "@BootstrapBot help" to see available commands.`);
            console.log(`Unknown command "${command}" invoked by user ${userId}.`);
    }
});

// Login to Discord
client.login(config.discordToken).catch(console.error);
