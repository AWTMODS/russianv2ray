require('dotenv').config();
const { User, connectDB } = require('../db');
const crypto = require('crypto');
const mongoose = require('mongoose');

async function backfill() {
    try {
        console.log('🚀 Starting SubId backfill for existing users...');
        await connectDB();

        const users = await User.find({ subId: { $exists: false } });
        console.log(`👥 Found ${users.length} users needing a SubId.`);

        let updatedCount = 0;
        for (const user of users) {
             // Generate a random 16-character string
            user.subId = crypto.randomBytes(8).toString('hex');
            await user.save();
            updatedCount++;
            
            if (updatedCount % 100 === 0) {
                console.log(`✅ Updated ${updatedCount}/${users.length} users...`);
            }
        }

        console.log('\n-----------------------------------');
        console.log('🏁 Backfill finished!');
        console.log(`✅ Success: ${updatedCount}`);
        console.log('-----------------------------------\n');

    } catch (error) {
        console.error('💥 Error during backfill:', error);
    } finally {
        mongoose.connection.close();
        process.exit(0);
    }
}

backfill();
