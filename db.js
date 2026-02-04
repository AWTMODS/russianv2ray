const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    telegramId: { type: String, required: true, unique: true },
    username: String,
    firstName: String,
    lastName: String,
    trialUsed: { type: Boolean, default: false },
    subscriptionStatus: {
        type: String,
        enum: ['none', 'trial', 'premium'],
        default: 'none'
    },
    keyExpiry: Date,
    uuid: String,
    email: String,
    inboundId: Number,
    createdAt: { type: Date, default: Date.now }
});

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('MongoDB connected successfully');
    } catch (err) {
        console.error('MongoDB connection error:', err);
        process.exit(1);
    }
};

module.exports = {
    User: mongoose.model('User', userSchema),
    connectDB
};
