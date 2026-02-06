<<<<<<< HEAD
const mongoose = require('mongoose');

// Mongoose 6 strictQuery preparation
mongoose.set('strictQuery', false);

// Connect to MongoDB
const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log(`✅ MongoDB Connection Initiated: ${process.env.MONGODB_URI}`);
    } catch (err) {
        console.error('❌ MongoDB Initial Connection Error:', err);
        process.exit(1);
    }
};

mongoose.connection.on('connected', () => {
    console.log('✅ MongoDB Connected successfully');
});

mongoose.connection.on('error', (err) => {
    console.error('❌ MongoDB Runtime Error:', err);
});

mongoose.connection.on('disconnected', () => {
    console.log('⚠️ MongoDB Disconnected');
});

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
=======
const mongoose = require('mongoose');

// Connect to MongoDB
const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log(`✅ MongoDB Connection Initiated: ${process.env.MONGODB_URI}`);
    } catch (err) {
        console.error('❌ MongoDB Initial Connection Error:', err);
        process.exit(1);
    }
};

mongoose.connection.on('connected', () => {
    console.log('✅ MongoDB Connected successfully');
});

mongoose.connection.on('error', (err) => {
    console.error('❌ MongoDB Runtime Error:', err);
});

mongoose.connection.on('disconnected', () => {
    console.log('⚠️ MongoDB Disconnected');
});

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
>>>>>>> 0b6771299652b90c6ba67f73ccd4bb1a0e57a8bb
