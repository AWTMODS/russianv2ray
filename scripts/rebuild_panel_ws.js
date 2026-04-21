require('dotenv').config();
const api = require('../api');
const { v4: uuidv4 } = require('uuid');

async function rebuildPanel() {
    try {
        console.log('🚀 Starting panel rebuild...');
        
        // 1. Login
        const loggedIn = await api.login();
        if (!loggedIn) {
            console.error('❌ Login failed. Check your PANEL_URL and credentials.');
            return;
        }

        // 2. Fetch current inbounds
        const inbounds = await api.getInbounds();
        console.log(`📡 Found ${inbounds.length} inbounds to delete.`);

        // 3. Delete all inbounds
        for (const inbound of inbounds) {
            console.log(`🗑️ Deleting inbound: ${inbound.remark} (ID: ${inbound.id})`);
            const result = await api.deleteInbound(inbound.id);
            if (result.success) {
                console.log(`✅ Deleted ID ${inbound.id}`);
            } else {
                console.error(`❌ Failed to delete ID ${inbound.id}: ${result.msg}`);
            }
        }

        // 4. Create new optimized VLESS-WS inbound
        console.log('\n🏗️ Creating new optimized VLESS-WS inbound...');
        const uuid = uuidv4();
        const remark = 'MyVPN';
        const port = 8080;
        const path = '/vpn';

        const inboundData = {
            remark: remark,
            port: port,
            protocol: 'vless',
            settings: JSON.stringify({
                clients: [
                    {
                        id: uuid,
                        flow: 'none'
                    }
                ],
                decryption: 'none',
                fallbacks: []
            }),
            streamSettings: JSON.stringify({
                network: 'ws',
                security: 'none',
                wsSettings: {
                    path: path,
                    headers: {}
                }
            }),
            sniffing: JSON.stringify({
                enabled: true,
                destOverride: ['http', 'tls', 'quic', 'fakedns']
            }),
            enable: true
        };

        const createResult = await api.addInbound(inboundData);
        if (createResult.success) {
            console.log('✅ Inbound created successfully!');
            const host = new URL(process.env.PANEL_URL).hostname;
            const vlessLink = `vless://${uuid}@${host}:${port}?type=ws&security=none&path=${encodeURIComponent(path)}#${encodeURIComponent(remark)}`;
            
            console.log('\n-----------------------------------');
            console.log('🚀 YOUR NEW VPN CONFIGURATION');
            console.log('-----------------------------------');
            console.log(`🔗 Link: ${vlessLink}`);
            console.log('-----------------------------------\n');
            console.log('📱 Optimized for v2rayNG, Hiddify, Shadowrocket, and others.');
        } else {
            console.error('❌ Failed to create inbound:', createResult.msg);
        }

    } catch (error) {
        console.error('💥 Critical error:', error);
    }
}

rebuildPanel();
