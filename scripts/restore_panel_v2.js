require('dotenv').config();
const api = require('../api');
const { v4: uuidv4 } = require('uuid');

async function restoreReality() {
    try {
        console.log('🚀 Restoring stable 443 Reality inbound...');
        
        // 1. Login
        const loggedIn = await api.login();
        if (!loggedIn) {
            console.error('❌ Login failed.');
            return;
        }

        // 2. Configuration for Reality
        const uuid = uuidv4();
        const port = 443;
        const remark = 'Portal-Reality (Stable)';
        
        // Keys generated earlier
        const publicKey = 'O49ivVpk585mkiV1bqNj684NCVMfUjzboxd7bZgtoBQ=';
        const privateKey = 'kMw6RASY8A8SnaIT2VoBX0clICuPu6SPCywfywC/jH4=';
        const shortId = 'cedbd70a';

        const inboundData = {
            remark: remark,
            port: port,
            protocol: 'vless',
            settings: JSON.stringify({
                clients: [
                    {
                        id: uuid,
                        flow: 'xtls-rprx-vision'
                    }
                ],
                decryption: 'none',
                fallbacks: []
            }),
            streamSettings: JSON.stringify({
                network: 'tcp',
                security: 'reality',
                realitySettings: {
                    show: false,
                    dest: 'github.com:443',
                    xver: 0,
                    serverNames: ['github.com', 'microsoft.com'],
                    privateKey: privateKey,
                    minClientVer: '',
                    maxClientVer: '',
                    maxTimeDiff: 0,
                    shortIds: [shortId]
                },
                tcpSettings: {
                    acceptProxyProtocol: false,
                    header: {
                        type: 'none'
                    }
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
            console.log('✅ 443 Reality Inbound created successfully!');
            
            // Output link details for .env sync
            console.log('\n--- SYNC THIS TO .env ---');
            console.log(`VLESS_PBK=${publicKey}`);
            console.log(`VLESS_SID=${shortId}`);
            console.log(`VLESS_REMARK=${remark}`);
            console.log('--------------------------\n');

        } else {
            console.error('❌ Failed to create 443 inbound:', createResult.msg);
        }

    } catch (error) {
        console.error('💥 Critical error:', error);
    }
}

restoreReality();
