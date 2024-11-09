const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require("cors"); 
const crypto = require('crypto')

const app = express();
const PORT = 3000;
const taskCooldown = 86400 * 1000; // 24 hours in milliseconds

app.use(cors({
    origin: ['http://localhost:5173', 'https://noma.money'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: false
}));

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
    subscription.lastTask = now;
  
    // Save updated subscription data
    saveSubscriptionData();
  
    res.json({
      message: `Task generated successfully 🙌 Please post this text on X/Twitter to complete your task: 
      
                    "I am participating in the Noma protocol bootstrap event. Unique code: ${newTaskCode}.
                    
                    #DeFi #Ethereum"`,
      taskCode: newTaskCode
    });
  });
  

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
