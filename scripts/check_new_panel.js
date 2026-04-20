require('dotenv').config();
const api = require('../api');

async function checkPanel() {
    console.log('Testing connection to the new panel...');
    console.log('URL:', process.env.PANEL_URL);
    
    try {
        const inbounds = await api.getInbounds();
        if (inbounds && inbounds.length > 0) {
            console.log('✅ Connection successful!');
            console.log('Available Inbounds:');
            inbounds.forEach(i => {
                console.log(`- ID: ${i.id}, Remark: ${i.remark}, Protocol: ${i.protocol}, Port: ${i.port}`);
            });
        } else {
            console.log('❌ Connection failed or no inbounds found. Check your .env credentials and PANEL_URL.');
        }
    } catch (error) {
        console.error('❌ Error during check:', error.message);
    }
}

checkPanel();
