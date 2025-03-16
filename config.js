require('dotenv').config(); // Load environment variables from .env file
const contractABI = require('./data/Presale.json'); // Load the ABI from the JSON file

module.exports = {
    discordToken: process.env.DISCORD_TOKEN,
    twitterApi: {
        appKey: process.env.TWITTER_APP_KEY,
        appSecret: process.env.TWITTER_APP_SECRET,
        accessToken: process.env.TWITTER_ACCESS_TOKEN,
        accessSecret: process.env.TWITTER_ACCESS_SECRET,
        bearerToken: process.env.TWITTER_BEARER_TOKEN
    },
    userToken: process.env.USER_TOKEN,
    userToken2: process.env.USER_TOKEN_2,
    userToken3: process.env.USER_TOKEN_3,
    chanId: '1343268730775404664', //'1303781041655513229',
    monitoredChannels: [
        "1252388983514726500", 
        "1252416316921610320", 
        "1303781041655513229", 
        "1252356104055291975"
    ],
    serverIDs: ["1252348309813596191", "1106982563853111296"],
    whitelistedUsers: [
        "1219798412287938691",
    ],
    contractABI, // Add the ABI to the exported configuration
    contractAddress: 0x0000000000000000000000000000,
    restrictionDate: '2024-11-07T00:00:00Z',
    taskCooldown: 86400000, // 24 hours in milliseconds,
    bannedWords: ['airdrop', 'subscribe', 'job offer', 'earn', 'win', 'recover', 'seed phrase', 'send to Binance']
};
