require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { User, connectDB } = require('../db');
const api = require('../api');
const mongoose = require('mongoose');

/**
 * Generate XRAY Reality keys and Short ID
 */
function generateRealitySettings() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
    
    // X25519 raw keys are 32 bytes
    const pubBase64 = publicKey.export({ type: 'spki', format: 'der' }).slice(-32).toString('base64');
    const privBase64 = privateKey.export({ type: 'pkcs8', format: 'der' }).slice(-32).toString('base64');
    const shortId = crypto.randomBytes(4).toString('hex');
    
    return { pubBase64, privBase64, shortId };
}

/**
 * Update .env file with new values
 */
function updateEnv(updates) {
    const envPath = path.join(__dirname, '../.env');
    let envContent = fs.readFileSync(envPath, 'utf8');
    
    for (const [key, value] of Object.entries(updates)) {
        const regex = new RegExp(`^${key}=.*`, 'm');
        if (regex.test(envContent)) {
            envContent = envContent.replace(regex, `${key}=${value}`);
        } else {
            envContent += `\n${key}=${value}`;
        }
    }
    
    fs.writeFileSync(envPath, envContent);
    console.log('✅ Updated .env file.');
}

async function run() {
    try {
        console.log('🚀 Starting Setup and Migration...');

        // 1. Generate Settings
        const { pubBase64, privBase64, shortId } = generateRealitySettings();
        console.log('✨ Generated new Reality keys and Short ID.');

        // 2. Connect to Panel
        const loggedIn = await api.login();
        if (!loggedIn) {
            console.error('❌ Failed to log into the panel.');
            process.exit(1);
        }

        // 3. Create Inbound
        const inboundData = {
            remark: 'Portal VPN (Auto-Setup)',
            enable: true,
            listen: '',
            port: 443,
            protocol: 'vless',
            settings: JSON.stringify({
                clients: [],
                decryption: 'none',
                fallbacks: []
            }),
            streamSettings: JSON.stringify({
                network: 'tcp',
                security: 'reality',
                externalProxy: [],
                realitySettings: {
                    show: false,
                    xver: 0,
                    dest: 'github.com:443',
                    serverNames: ['github.com'],
                    privateKey: privBase64,
                    minClient: '',
                    maxClient: '',
                    maxTimediff: 0,
                    shortIds: [shortId],
                    settings: {
                        publicKey: pubBase64,
                        fingerprint: 'chrome',
                        serverName: '',
                        spiderX: '/'
                    }
                }
            }),
            sniffing: JSON.stringify({
                enabled: true,
                destOverride: ['http', 'tls', 'quic']
            })
        };

        const result = await api.addInbound(inboundData);
        if (!result.success) {
            console.error('❌ Failed to create inbound:', result.msg);
            process.exit(1);
        }

        const newInboundId = result.obj.id;
        console.log(`✅ Created new VLESS Reality inbound. ID: ${newInboundId}`);

        // 4. Update .env
        updateEnv({
            TRIAL_INBOUND_ID: newInboundId,
            PREMIUM_INBOUND_ID: newInboundId,
            VLESS_PBK: pubBase64,
            VLESS_SID: shortId
        });

        // 5. Connect to MongoDB and Migrate Users
        console.log('📦 Connecting to MongoDB for migration...');
        await connectDB();
        
        const users = await User.find({ uuid: { $exists: true, $ne: null } });
        console.log(`👥 Found ${users.length} users to migrate.`);

        let successCount = 0;
        let failCount = 0;

        for (const user of users) {
             const clientResult = await api.addClient(
                { uuid: user.uuid, email: user.email || `user_${user.telegramId}` },
                newInboundId,
                user.keyExpiry ? user.keyExpiry.getTime() : 0
            );

            if (clientResult.success) {
                successCount++;
                // Update user record in DB with the new inbound ID
                user.inboundId = newInboundId;
                await user.save();
            } else {
                console.error(`❌ Failed to migrate user ${user.telegramId}: ${clientResult.msg}`);
                failCount++;
            }
        }

        console.log('\n-----------------------------------');
        console.log('🏁 Setup and Migration finished!');
        console.log(`📡 New Inbound ID: ${newInboundId}`);
        console.log(`✅ Success: ${successCount}`);
        console.log(`❌ Failed: ${failCount}`);
        console.log(`👥 Total: ${users.length}`);
        console.log('-----------------------------------\n');
        console.log('⚠️  Users can now get their NEW links by typing /start in the bot.');

    } catch (error) {
        console.error('💥 Error:', error);
    } finally {
        mongoose.connection.close();
        process.exit(0);
    }
}

run();
