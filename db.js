const mongoose = require('mongoose');

// Mongoose 6 strictQuery preparation
mongoose.set('strictQuery', false);

// Connect to MongoDB with retry logic
const connectDB = async (retries = 3, delay = 2000) => {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            console.log(`Attempting MongoDB connection (${attempt}/${retries})...`);
            await mongoose.connect(process.env.MONGODB_URI, {
                serverSelectionTimeoutMS: 5000,
                socketTimeoutMS: 45000,
            });
            console.log(`✅ MongoDB Connection Successful`);
            return;
        } catch (err) {
            console.error(`❌ MongoDB Connection Attempt ${attempt} Failed:`, err.message);

            if (attempt === retries) {
                console.error('\n❌ All MongoDB connection attempts failed!');
                console.error('Error details:', {
                    message: err.message,
                    code: err.code,
                    name: err.name
                });
                console.error('\nPossible solutions:');
                console.error('1. Check if MongoDB Atlas cluster is active (not paused)');
                console.error('2. Verify network access settings in MongoDB Atlas');
                console.error('3. Ensure your IP is whitelisted (or use 0.0.0.0/0 for testing)');
                console.error('4. Verify database credentials in .env file');
                console.error('5. Check internet connectivity\n');
                throw err;
            }

            console.log(`Retrying in ${delay / 1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2; // Exponential backoff
        }
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
