const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const cors = require("cors"); 

const app = express();
const PORT = 3000; // HTTPS port, commonly 443 for production

// Load SSL certificates
const sslOptions = {
    key: fs.readFileSync(path.join(__dirname, '/server.key')),  // Update with actual path
    cert: fs.readFileSync(path.join(__dirname, '/server.cert'))  // Update with actual path
};

app.use(cors({
    origin: 'http://localhost:5173',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: false
}));

// Path to your JSON file
const dataFilePath = path.join(__dirname, '../data/subscriptionCodes.json');

// Function to load JSON data from the file
function loadSubscriptionData() {
    if (fs.existsSync(dataFilePath)) {
        const data = fs.readFileSync(dataFilePath, 'utf-8');
        return JSON.parse(data);
    }
    return {};
}

app.options('/get-subscription', cors());
app.get('/get-subscription', (req, res) => {
    const { address } = req.query;

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
        return res.status(404).json({ error: 'Subscription not found for the given address' });
    }
});

// Start HTTPS server
https.createServer(sslOptions, app).listen(PORT, () => {
    console.log(`Secure server is running on https://localhost:${PORT}`);
});
