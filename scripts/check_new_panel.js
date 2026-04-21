require('dotenv').config();
const api = require('../api');

async function checkInbound() {
    try {
        console.log('Logging in to panel...');
        await api.login();
        
        console.log('Fetching inbounds...');
        const inbounds = await api.getInbounds();
        
        // Find the inbound with ID from process.env.PREMIUM_INBOUND_ID or TRIAL_INBOUND_ID
        const targetId = parseInt(process.env.PREMIUM_INBOUND_ID || '1', 10);
        const inbound = inbounds.find(i => i.id === targetId);
        
        if (!inbound) {
            console.error(`Inbound with ID ${targetId} not found.`);
            console.log('Available inbounds:', inbounds.map(i => ({ id: i.id, remark: i.remark, port: i.port })));
            return;
        }
        
        console.log('Found Inbound:', inbound.remark);
        const streamSettings = JSON.parse(inbound.streamSettings);
        const realitySettings = streamSettings.realitySettings;
        
        if (!realitySettings) {
            console.log('This is not a REALITY inbound.');
            console.log('Stream Settings:', JSON.stringify(streamSettings, null, 2));
            return;
        }

        console.log('\n--- CURRENT PANEL SETTINGS ---');
        console.log('PORT:', inbound.port);
        console.log('PBK (Public Key):', realitySettings.settings.publicKey);
        console.log('SID (Short ID):', realitySettings.shortIds[0] || '');
        console.log('SNI (Server Names):', realitySettings.serverNames.join(', '));
        console.log('SPX (Spider X):', realitySettings.settings.spiderX || '/');
        
        // Settings for .env
        console.log('\n--- RECOMMENDED .env UPDATES ---');
        console.log(`VLESS_PORT=${inbound.port}`);
        console.log(`VLESS_PBK=${realitySettings.settings.publicKey}`);
        console.log(`VLESS_SID=${realitySettings.shortIds[0] || ''}`);
        console.log(`VLESS_SNI=${realitySettings.serverNames[0] || 'github.com'}`);
        console.log(`VLESS_SPX=${realitySettings.settings.spiderX || '/'}`);
        
    } catch (err) {
        console.error('Error fetching inbound:', err.message);
    }
}

checkInbound();
