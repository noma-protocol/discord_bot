// cmd.js

const { ethers } = require('ethers'); // Import ethers.js for Ethereum address validation

/**
 * Handles the 'subscribe' command.
 * @param {Message} message - The Discord message object.
 * @param {Array} args - The command arguments.
 * @param {Object} context - An object containing necessary dependencies and data.
 */
async function handleSubscribeCommand(message, args, context) {
    const userId = message.author.id;
    const {
        subscriptionCodes,
        saveSubscriptionCodes,
        config,
        generateUniqueCode,
        isAddressAlreadyRegistered,
        isAfterRestrictionDate,
        lastTwitterCallTime
    } = context;

    try {
        console.log(`Subscribe command invoked by user ${userId}`);

        // Check if the current date is after the restriction date
        if (!isAfterRestrictionDate()) {
            message.reply('This command will be available after November 7, 0:00 UTC.');
            console.log(`User ${userId} attempted to subscribe before restriction date.`);
            return;
        }

        // Ensure the command is used in Direct Messages (DMs)
        if (message.guild) {
            message.reply('The "subscribe" command can only be used in a direct message.');
            console.log(`User ${userId} attempted to use "subscribe" command in a server channel.`);
            return;
        }

        // Check if the user is already registered
        if (subscriptionCodes[userId]) {
            message.reply('You are already registered.');
            console.log(`User ${userId} is already registered.`);
            return;
        }

        // Validate command arguments
        if (args.length < 2) {
            message.reply('Usage: subscribe @TwitterHandle 0xYourEthereumAddress');
            console.log(`User ${userId} provided insufficient arguments for subscribe.`);
            return;
        }

        const twitterHandle = args[0].startsWith('@') ? args[0].slice(1) : args[0];
        const ethereumAddress = args[1];

        // Validate Twitter handle format
        if (!/^[A-Za-z0-9_]{1,15}$/.test(twitterHandle)) {
            message.reply('Invalid Twitter handle.');
            console.log(`User ${userId} provided an invalid Twitter handle: ${twitterHandle}`);
            return;
        }

        // Validate Ethereum address using ethers.js
        if (!ethers.utils.isAddress(ethereumAddress)) {
            message.reply('Invalid Ethereum address.');
            console.log(`User ${userId} provided an invalid Ethereum address: ${ethereumAddress}`);
            return;
        }

        // Check if the Ethereum address is already registered
        if (isAddressAlreadyRegistered(ethereumAddress)) {
            message.reply('This Ethereum address is already registered.');
            console.log(`Ethereum address ${ethereumAddress} is already registered.`);
            return;
        }

        // Generate a unique subscription code
        const uniqueCode = generateUniqueCode();

        // Register the user
        subscriptionCodes[userId] = { 
            code: uniqueCode, 
            twitterHandle, 
            verified: false, 
            balance: 0,
            triviaBalance: 0, 
            lastTask: null, 
            address: ethereumAddress 
        };

        // Save the updated subscription data
        saveSubscriptionCodes();

        // Send instructions to the user
        message.reply(`Please post the following text on X/Twitter: 

"I want to be whitelisted for the Noma protocol bootstrap event. Unique code: ${uniqueCode}. Follow Noma on X/Twitter [x.com/nomaprotocol](https://x.com/nomaprotocol) and join the Discord community [discord.gg/nomaprotocol](https://discord.gg/nomaprotocol) #Base #Ethereum #DeFi $NOMA" 

Once done, use the "@BootstrapBot finalize" command to complete the process.`);

        console.log(`User ${userId} subscribed successfully with Ethereum address ${ethereumAddress} and Twitter handle ${twitterHandle}.`);
    } catch (error) {
        console.error(`Error in subscribe command for user ${userId}:`, error);
        message.reply('An error occurred while processing your subscription. Please try again later.');
    }
}

/**
 * Handles the 'finalize' command.
 * @param {Message} message - The Discord message object.
 * @param {Array} args - The command arguments.
 * @param {Object} context - An object containing necessary dependencies and data.
 */
async function handleFinalizeCommand(message, args, context) {
    const userId = message.author.id;
    const {
        subscriptionCodes,
        saveSubscriptionCodes,
        checkTwitterPostForCode,
        isAfterRestrictionDate
    } = context;

    try {
        console.log(`Finalize command invoked by user ${userId}`);

        // Check if the current date is after the restriction date
        if (!isAfterRestrictionDate()) {
            message.reply('This command will be available after November 7, 0:00 UTC.');
            console.log(`User ${userId} attempted to finalize before restriction date.`);
            return;
        }

        // Ensure the command is used in Direct Messages (DMs)
        if (message.guild) {
            message.reply('The "finalize" command can only be used in a direct message.');
            console.log(`User ${userId} attempted to use "finalize" command in a server channel.`);
            return;
        }

        // Check if the user has subscribed
        const subscription = subscriptionCodes[userId];
        if (!subscription) {
            message.reply('Please subscribe first using the "subscribe" command.');
            console.log(`User ${userId} attempted to finalize without subscribing.`);
            return;
        }

        // Check if the user is already verified
        if (subscription.verified) {
            message.reply('You are already verified.');
            console.log(`User ${userId} is already verified.`);
            return;
        }

        const { code, twitterHandle } = subscription;

        // Verify the user's Twitter post
        const isVerified = await checkTwitterPostForCode(twitterHandle, code);
        if (isVerified) {
            message.reply('Verified successfully. You are now whitelisted!');
            subscriptionCodes[userId].verified = true;
            saveSubscriptionCodes();
            console.log(`User ${userId} verified successfully.`);
        } else {
            message.reply('Verification failed. Please ensure you have posted the correct code on Twitter.');
            console.log(`User ${userId} failed verification.`);
        }
    } catch (error) {
        console.error(`Error in finalize command for user ${userId}:`, error);
        message.reply('An error occurred during verification. Please try again later.');
    }
}

/**
 * Handles the 'task' command.
 */
async function handleTaskCommand(message, args, context) {
    const { subscriptionCodes, saveSubscriptionCodes, generateUniqueCode, isAfterRestrictionDate, taskCooldown } = context;
    const userId = message.author.id;

    if (!isAfterRestrictionDate()) {
        message.reply('This command will be available after November 7, 0:00 UTC.');
        return;
    }

    if (message.guild) {
        message.reply('The "task" command can only be used in a direct message.');
        return;
    }

    const subscription = subscriptionCodes[userId];
    if (!subscription) {
        message.reply('You need to subscribe first using `subscribe @TwitterHandle 0xYourEthereumAddress`.');
        return;
    }

    const now = Date.now();
    if (subscription.lastTask) {
        const timeSinceLastTask = now - new Date(subscription.lastTask).getTime();
        if (timeSinceLastTask < taskCooldown) {
            message.reply('You can only complete one task per day. Please try again tomorrow.');
            return;
        }
    }

    const newTaskCode = generateUniqueCode();
    subscriptionCodes[userId].code = newTaskCode;

    
    saveSubscriptionCodes();

    message.reply('Please post this text on X/Twitter to complete your task: \n ' +
        '"I am participating in the Noma protocol bootstrap event `🚀` Unique code: ' + newTaskCode + ' `🍀` Follow Noma on X/Twitter x.com/nomaprotocol and join the Discord community discord.gg/nomaprotocol #Base #Ethereum #DeFi $NOMA" \n\n ' +
        ' Once done, use the "@BootstrapBot verify task" command to complete the process');

    console.log(`Task generated for user ${userId} with code ${newTaskCode}`);
}

/**
 * Handles the 'verify task' command.
 */
async function handleVerifyTaskCommand(message, args, context) {
    const { subscriptionCodes, saveSubscriptionCodes, checkTwitterPostForCode, isAfterRestrictionDate, taskCooldown } = context;
    const userId = message.author.id;

    if (!isAfterRestrictionDate()) {
        message.reply('This command will be available after November 7, 0:00 UTC.');
        return;
    }

    if (message.guild) {
        message.reply('The "verify task" command can only be used in a direct message.');
        return;
    }

    const subscription = subscriptionCodes[userId];
    if (!subscription) {
        message.reply('Please subscribe first.');
        return;
    }

    const now = Date.now();
    const { code, twitterHandle } = subscription;

    // Ensure the task cooldown is checked only if the task has already been verified before
    if (subscription.lastTask) {
        const timeSinceLastTask = now - new Date(subscription.lastTask).getTime();
        if (timeSinceLastTask < taskCooldown) {
            message.reply('You can only complete one task per day. Please try again tomorrow.');
            return;
        }
    }

    const isVerified = await checkTwitterPostForCode(twitterHandle, code);
    if (isVerified) {
        // Update balance and lastTask
        subscription.lastTask = now;
        subscription.balance = (subscription.balance || 0) + 1000;

        // Explicitly update subscriptionCodes[userId]
        subscriptionCodes[userId] = subscription;        
        saveSubscriptionCodes();

        message.reply('Verified successfully.');
    } else {
        message.reply('Verification failed.');
    }
}

module.exports = {
    handleSubscribeCommand,
    handleFinalizeCommand,
    handleTaskCommand,
    handleVerifyTaskCommand
};