require('dotenv').config();
const { User, connectDB } = require('../db');
const mongoose = require('mongoose');

async function resetTrials() {
    try {
        console.log('🔌 Connecting to database...');
        await connectDB();
        
        console.log('🔄 Resetting trial status for all users...');
        const result = await User.updateMany({}, { 
            $set: { 
                trialUsed: false,
                trialExpiryReminderSent: false,
                trialExpiredReminderSent: false,
                subscriptionStatus: 'free'
            } 
        });
        
        console.log(`✅ Success! Reset trials for ${result.modifiedCount} users.`);
        
        mongoose.connection.close();
        process.exit(0);
    } catch (error) {
        console.error('❌ Error resetting trials:', error);
        process.exit(1);
    }
}

resetTrials();
