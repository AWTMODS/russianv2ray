const mongoose = require('mongoose');

// Connect to MongoDB
const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGODB_URI);
        console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    } catch (err) {
        console.error('❌ MongoDB Connection Error:', err);
        process.exit(1);
    }
};

// Define User Schema
const UserSchema = new mongoose.Schema({
    telegramId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    username: String,
    firstName: String,
    lastName: String,
    trialUsed: {
        type: Boolean,
        default: false
    },
    subscriptionStatus: {
        type: String,
        enum: ['trial', 'premium', 'free'],
        default: 'free'
    },
    keyExpiry: Date,
    uuid: String,
    email: String,
    inboundId: Number,
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Static method to find one user (emulating previous behavior)
UserSchema.statics.findOneUser = async function (telegramId) {
    return await this.findOne({ telegramId: telegramId });
};

const User = mongoose.model('User', UserSchema);

module.exports = {
    User,
    connectDB
};
