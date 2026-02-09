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
    // Payment tracking fields
    lastPaymentId: String,
    lastPaymentStatus: {
        type: String,
        enum: ['pending', 'success', 'failed', 'cancelled'],
        default: null
    },
    paymentHistory: [{
        transactionId: String,
        amount: Number,
        status: String,
        createdAt: Date
    }],
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

// Payment Schema for detailed transaction tracking
const PaymentSchema = new mongoose.Schema({
    transactionId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    externalId: {
        type: String,
        required: true,
        index: true
    },
    userId: {
        type: String,
        required: true,
        index: true
    },
    amount: {
        type: Number,
        required: true
    },
    currency: {
        type: String,
        default: 'RUB'
    },
    status: {
        type: String,
        enum: ['pending', 'success', 'failed', 'cancelled', 'refunded'],
        default: 'pending'
    },
    subscriptionMonths: {
        type: Number,
        required: true
    },
    paymentUrl: String,
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    completedAt: Date
});

const Payment = mongoose.model('Payment', PaymentSchema);

module.exports = {
    User,
    Payment,
    connectDB
};
