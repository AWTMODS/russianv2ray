require('dotenv').config();
const { User, connectDB } = require('../db');
const api = require('../api');
const mongoose = require('mongoose');

async function migrate() {
    try {
        console.log('🚀 Starting migration to new panel...');
        
        // 1. Connect to MongoDB
        await connectDB();
        
        // 2. Refresh panel connection/session
        const loggedIn = await api.login();
        if (!loggedIn) {
            console.error('❌ Failed to log into the new panel. Check PANEL_URL and credentials.');
            process.exit(1);
        }

        // 3. Check inbounds on the panel
        const inbounds = await api.getInbounds();
        if (!inbounds || inbounds.length === 0) {
            console.error('❌ No inbounds found on the new panel.');
            console.error('👉 Please create a VLESS inbound on the panel before running this script.');
            process.exit(1);
        }
        
        console.log(`📡 Found ${inbounds.length} inbounds on the panel.`);
        
        // 4. Fetch users from MongoDB
        const users = await User.find({ uuid: { $exists: true, $ne: null } });
        console.log(`👥 Found ${users.length} users with keys in database.`);

        if (users.length === 0) {
            console.log('ℹ️ No users to migrate.');
            process.exit(0);
        }

        let successCount = 0;
        let failCount = 0;

        // 5. Migrate users
        for (const user of users) {
            console.log(`\n⏳ Migrating user: ${user.email || user.telegramId} (${user.subscriptionStatus})`);
            
            // Use the inbound ID from the database if present, otherwise fallback to .env or first available
            // Prioritize the environment variables for the NEW panel migration
            const inboundId = parseInt(process.env.PREMIUM_INBOUND_ID, 10) || user.inboundId || inbounds[0].id;
            const expiryTime = user.keyExpiry ? user.keyExpiry.getTime() : 0;

            const result = await api.addClient(
                { uuid: user.uuid, email: user.email || `user_${user.telegramId}` },
                inboundId,
                expiryTime
            );

            if (result.success) {
                console.log(`✅ Successfully added to panel (Inbound ID: ${inboundId})`);
                successCount++;
            } else {
                console.error(`❌ Failed: ${result.msg}`);
                failCount++;
            }
        }

        console.log('\n-----------------------------------');
        console.log('🏁 Migration finished!');
        console.log(`✅ Success: ${successCount}`);
        console.log(`❌ Failed: ${failCount}`);
        console.log(`👥 Total attempted: ${users.length}`);
        console.log('-----------------------------------\n');

    } catch (error) {
        console.error('💥 Critical error during migration:', error);
    } finally {
        mongoose.connection.close();
    }
}

migrate();
