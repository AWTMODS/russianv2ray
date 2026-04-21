require('dotenv').config();
const api = require('../api');

async function applyFinalFix() {
    try {
        console.log('🚀 Applying final Reality key fix...');
        
        await api.login();
        const inbounds = await api.getInbounds();
        
        // 1. Update Reality Inbound (ID 8)
        const reality = inbounds.find(i => i.id === 8 || i.remark.includes('Reality'));
        if (reality) {
            console.log(`🔧 Updating Reality Inbound (ID: ${reality.id}) with native Xray keys...`);
            
            // Native keys from VPS output
            const privKey = '-I-sQH-HZDw014vV8n9vjs-M_mrlsg8fy6G8bFD06Fo';
            const pubKey = 'LM2cnMfyW_ICeLFZ09Bz5qPrbclJq2BN_GW0RkrwHlw';
            const shortId = 'cedbd70a';

            const streamSettings = JSON.parse(reality.streamSettings);
            streamSettings.realitySettings.privateKey = privKey;
            streamSettings.realitySettings.shortIds = [shortId];
            
            const result = await api.updateInbound(reality.id, {
                remark: 'Portal-Reality (Stable)',
                port: 443,
                protocol: 'vless',
                settings: reality.settings,
                streamSettings: JSON.stringify(streamSettings),
                sniffing: reality.sniffing,
                enable: true
            });
            
            if (result.success) {
                console.log('✅ Reality inbound updated with valid keys.');
                console.log('\n--- SYNC THIS TO .env ---');
                console.log(`VLESS_PBK=${pubKey}`);
                console.log(`VLESS_SID=${shortId}`);
                console.log('--------------------------\n');
            } else {
                console.error('❌ Failed to update reality:', result.msg);
            }
        }

        // 2. Disable ID 7 to avoid any other crashes
        const myVpn = inbounds.find(i => i.id === 7);
        if (myVpn) {
            console.log('🔧 Disabling ID 7 to ensure clean start...');
            await api.updateInbound(myVpn.id, { ...myVpn, enable: false });
        }

    } catch (err) {
        console.error('Error:', err.message);
    }
}

applyFinalFix();
