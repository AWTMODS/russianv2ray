const mongoose = require('mongoose');
const fs = require('fs');
const { User } = require('./db');

const DB_URI = "mongodb://awtwhatsappcrashlog_db_user:iiCqFZIckXAPb1Bm@ac-u2j0ikz-shard-00-00.xgv6qms.mongodb.net:27017,ac-u2j0ikz-shard-00-01.xgv6qms.mongodb.net:27017,ac-u2j0ikz-shard-00-02.xgv6qms.mongodb.net:27017/test?ssl=true&replicaSet=atlas-z3adf0-shard-0&authSource=admin&appName=v2rayvpn";

async function extractUsers() {
    try {
        await mongoose.connect(DB_URI);
        const now = new Date();
        const users = await User.find({
            subscriptionStatus: 'premium',
            keyExpiry: { $gt: now }
        });
        
        let output = "";
        users.forEach(u => {
            const dateStr = u.keyExpiry ? u.keyExpiry.toISOString().split('T')[0] : 'No Expiry';
            output += `${u.telegramId} - ${dateStr}\n`;
        });
        
        fs.writeFileSync('active_users_utf8.txt', output, 'utf8');
        console.log(`Saved ${users.length} users to active_users_utf8.txt`);
        
    } catch (e) {
        console.error("Error extracting users:", e);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}

extractUsers();
