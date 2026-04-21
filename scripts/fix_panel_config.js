require('dotenv').config();
const api = require('../api');

async function fixConfig() {
    try {
        console.log('🚀 Fixing Xray configuration errors...');
        
        const loggedIn = await api.login();
        if (!loggedIn) return;

        const inbounds = await api.getInbounds();
        
        // 1. Fix MyVPN (WebSocket)
        const myVpn = inbounds.find(i => i.remark === 'MyVPN');
        if (myVpn) {
            console.log(`🔧 Updating MyVPN (ID: ${myVpn.id})`);
            const settings = JSON.parse(myVpn.settings);
            settings.clients[0].flow = ""; // Fix the "none" error
            
            const updateData = {
                remark: myVpn.remark,
                port: 8085, // Move away from Apache
                protocol: myVpn.protocol,
                settings: JSON.stringify(settings),
                streamSettings: myVpn.streamSettings,
                sniffing: myVpn.sniffing,
                enable: true
            };
            
            const result = await api.updateInbound(myVpn.id, updateData);
            if (result.success) {
                console.log('✅ MyVPN fixed and moved to port 8085.');
            } else {
                console.error('❌ Failed to fix MyVPN:', result.msg);
            }
        }

        // 2. Refresh Reality (just in case)
        const reality = inbounds.find(i => i.remark === 'Portal-Reality (Stable)');
        if (reality) {
            console.log(`🔧 Refreshing Reality Inbound (ID: ${reality.id})`);
            // We just ensure it's enabled and correctly configured
            const result = await api.updateInbound(reality.id, {
                remark: reality.remark,
                port: reality.port,
                protocol: reality.protocol,
                settings: reality.settings,
                streamSettings: reality.streamSettings,
                sniffing: reality.sniffing,
                enable: true
            });
            if (result.success) console.log('✅ Reality inbound refreshed.');
        }

        console.log('\n🏁 Fix attempt finished. Xray should now restart successfully.');

    } catch (err) {
        console.error('Error during fix:', err.message);
    }
}

fixConfig();
