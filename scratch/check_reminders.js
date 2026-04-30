require('dotenv').config();
const { User, connectDB } = require('../db');
const mongoose = require('mongoose');

async function checkReminders() {
    try {
        await connectDB();
        const now = new Date();
        const in24h = new Date(Date.now() + 24 * 60 * 60 * 1000);

        console.log('Current time:', now);

        const expiringSoon = await User.find({
            subscriptionStatus: { $in: ['trial', 'premium'] },
            keyExpiry: { $gt: now, $lte: in24h }
        });
        console.log(`Users expiring in 24h: ${expiringSoon.length}`);
        expiringSoon.forEach(u => {
            console.log(`- ${u.telegramId}: ${u.keyExpiry}, reminderSent: ${u.trialExpiryReminderSent}`);
        });

        const expired = await User.find({
            subscriptionStatus: { $in: ['trial', 'premium'] },
            keyExpiry: { $lte: now }
        });
        console.log(`Users already expired: ${expired.length}`);
        expired.forEach(u => {
            console.log(`- ${u.telegramId}: ${u.keyExpiry}, expiredReminderSent: ${u.trialExpiredReminderSent}`);
        });

        mongoose.connection.close();
    } catch (err) {
        console.error(err);
    }
}

checkReminders();
