require('dotenv').config(); // Load environment variables from .env file

module.exports = {
    discordToken: process.env.DISCORD_TOKEN,
    twitterApi: {
        appKey: process.env.TWITTER_APP_KEY,
        appSecret: process.env.TWITTER_APP_SECRET,
        accessToken: process.env.TWITTER_ACCESS_TOKEN,
        accessSecret: process.env.TWITTER_ACCESS_SECRET
    },
    serverIDs: ["1252348309813596191","1106982563853111296"]
};
