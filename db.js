const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'database.json');

// Helper to read DB with properly revitalized Date objects
const readDB = () => {
    if (!fs.existsSync(DB_FILE)) return [];
    try {
        const data = fs.readFileSync(DB_FILE, 'utf-8');
        return JSON.parse(data, (key, value) => {
            // Revive dates
            if (key === 'keyExpiry' || key === 'createdAt') {
                return value ? new Date(value) : null;
            }
            return value;
        });
    } catch (e) {
        console.error('Database read error, resetting:', e);
        return [];
    }
};

// Helper to write DB
const writeDB = (data) => {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
};

class User {
    constructor(data) {
        Object.assign(this, data);
        if (!this.createdAt) this.createdAt = new Date();
    }

    async save() {
        const users = readDB();
        const index = users.findIndex(u => u.telegramId === this.telegramId);

        // Ensure strictly plain object for saving to avoid circular structure or extra internal props
        const userData = { ...this };

        if (index >= 0) {
            users[index] = userData;
        } else {
            users.push(userData);
        }
        writeDB(users);
        return this;
    }

    static async findOne(query) {
        const users = readDB();
        const user = users.find(u => {
            for (let key in query) {
                // strict equality check
                if (u[key] !== query[key]) return false;
            }
            return true;
        });
        return user ? new User(user) : null;
    }
}

const connectDB = async () => {
    console.log(`📦 Using local file database: ${DB_FILE}`);
    if (!fs.existsSync(DB_FILE)) {
        writeDB([]);
        console.log('Created new database file.');
    } else {
        console.log('Database loaded successfully.');
    }
};

module.exports = {
    User,
    connectDB
};
