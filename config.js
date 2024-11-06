require('dotenv').config(); // Load environment variables from .env file
const contractABI = require('./data/Presale.json'); // Load the ABI from the JSON file

module.exports = {
    discordToken: process.env.DISCORD_TOKEN,
    twitterApi: {
        appKey: process.env.TWITTER_APP_KEY,
        appSecret: process.env.TWITTER_APP_SECRET,
        accessToken: process.env.TWITTER_ACCESS_TOKEN,
        accessSecret: process.env.TWITTER_ACCESS_SECRET
    },
    chanId: '1303781041655513229',
    serverIDs: ["1252348309813596191", "1106982563853111296"],
    contractABI, // Add the ABI to the exported configuration
    contractAddress: 0x0000000000000000000000000000
};
