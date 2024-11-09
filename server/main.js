const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require("cors"); 
const crypto = require('crypto')
const { TwitterApi } = require('twitter-api-v2');
// Load configuration from config.js
const config = require('../config');

const app = express();
const PORT = 3000;
const taskCooldown = config.taskCooldown;
// Initialize a variable to track the last Twitter API call time for throttling
let lastTwitterCallTime = 0;

app.use(cors({
    origin: ['http://localhost:5173', 'https://noma.money'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: false
}));

// Twitter API credentials from the configuration
const twitterClient = new TwitterApi({
    appKey: config.twitterApi.appKey,
    appSecret: config.twitterApi.appSecret,
    accessToken: config.twitterApi.accessToken,
    accessSecret: config.twitterApi.accessSecret
});

// Path to your JSON file
const dataFilePath = path.join(__dirname, '../data/subscriptionCodes.json');
// In-memory storage for subscription codes, loaded from disk
let subscriptionData = loadSubscriptionData();

// Function to load JSON data from the file
function loadSubscriptionData() {
    if (fs.existsSync(dataFilePath)) {
        const data = fs.readFileSync(dataFilePath, 'utf-8');
        return JSON.parse(data);
    }
    return {};
}

// Function to save JSON data to the file
function saveSubscriptionData() {
    try {
        console.log('Saving subscription data:', JSON.stringify(subscriptionData, null, 2));
        if (Object.keys(subscriptionData).length > 0) {
            fs.writeFileSync(dataFilePath, JSON.stringify(subscriptionData, null, 2), { flag: 'w' });
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

// Function to generate a unique code
function generateUniqueCode() {
    return crypto.randomBytes(4).toString('hex'); // Generates an 8-character hex code
}

app.options('/get-subscription', cors());
app.get('/get-subscription', (req, res) => {
    const { address } = req.query; // Get the 'address' parameter from the query string

    if (!address) {
        return res.status(400).json({ error: 'Address parameter is required' });
    }

    // Load the data
    const subscriptionData = loadSubscriptionData();

    // Search for the address in the JSON data
    const result = Object.values(subscriptionData).find(
        (entry) => entry.address && entry.address.toLowerCase() === address.toLowerCase()
    );

    if (result) {
        // If found, return the matching JSON data
        return res.json(result);
    } else {
        // If not found, return a 404 Not Found response
        return res.json({ error: 'Subscription not found for the given address' });
    }
});

// Task endpoint
app.options('/task', cors());
app.get('/task', (req, res) => {
    const { address } = req.query; // Get the 'address' parameter from the query string
  
    if (!address) {
      return res.status(400).json({ error: 'Address is required' });
    }
  
    // Find the subscription by wallet address
    const subscription = Object.values(subscriptionData).find(
      (entry) => entry.address && entry.address.toLowerCase() === address.toLowerCase()
    );
  
    if (!subscription) {
      return res.status(404).json({ error: 'User not found. Please subscribe first.' });
    }
  
    const now = Date.now();
  
    // Check if the user has completed a task recently
    if (subscription.lastTask) {
      const timeSinceLastTask = now - new Date(subscription.lastTask).getTime();
      if (timeSinceLastTask < taskCooldown) {
        return res.json({ error: 'Task already completed today. Please try again tomorrow.' });
      }
    }
  
    // Generate a new unique code for the task
    const newTaskCode = generateUniqueCode();
    subscription.code = newTaskCode;
  
    // Save updated subscription data
    saveSubscriptionData();

    const msg = 'Please post this text on X/Twitter to complete your task: \n ' +
        '"I am participating in the Noma protocol bootstrap event 🚀 Unique code: ' + newTaskCode + ' 🍀 Follow Noma on X/Twitter x.com/nomaprotocol and join the Discord community discord.gg/nomaprotocol #Base #Ethereum #DeFi $NOMA" \n\n ' +
        ' \n\n Once done, use the "@BootstrapBot verify task" command to complete the process'

    res.json({
        message: msg,
        taskCode: newTaskCode
      });
      
  });
  
  app.options('/verifytask', cors());
  app.post('/verifytask', express.json(), async (req, res) => {
      const { address } = req.body; // Expecting JSON body with 'address'
  
      if (!address) {
          return res.status(400).json({ error: 'Address is required' });
      }
  
      // Find the subscription by wallet address
      const subscription = Object.values(subscriptionData).find(
          (entry) => entry.address && entry.address.toLowerCase() === address.toLowerCase()
      );
  
      if (!subscription) {
          return res.status(404).json({ error: 'User not found. Please subscribe first.' });
      }
  
      const { code, twitterHandle } = subscription;
  
      if (!twitterHandle) {
          return res.json({ error: 'Twitter handle not found for this user. Please ensure you have registered correctly.' });
      }
  
      // Check if the code was posted on Twitter
      const isVerified = await checkTwitterPostForCode(twitterHandle, code);
      if (!isVerified) {
          return res.json({ error: 'Verification failed. Please ensure you have posted the correct code on Twitter.' });
      }
  
      const now = Date.now();
  
      // Check the cooldown for the last task
      if (subscription.lastTask) {
          const timeSinceLastTask = now - new Date(subscription.lastTask).getTime();
          if (timeSinceLastTask < taskCooldown) {
              return res.json({ error: 'You can only complete one task per day. Please try again tomorrow.' });
          }
      }
  
      // Update lastTask and balance upon successful verification
      subscription.lastTask = now;
      subscription.balance = (subscription.balance || 0) + 1;
  
      // Save updated subscription data
      saveSubscriptionData();
  
      res.json({
          message: 'Verified successfully. Task completed and balance updated.',
          balance: subscription.balance
      });
  
      console.log(`Task verified for user with address ${address}. Balance updated to ${subscription.balance}`);
  });
  
// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
