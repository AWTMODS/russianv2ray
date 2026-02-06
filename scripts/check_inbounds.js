require('dotenv').config();
const api = require('../api');

(async () => {
    console.log('--- Checking Inbounds ---');
    const inbounds = await api.getInbounds();

    console.log('--- Raw Response ---');
    console.dir(inbounds, { depth: null });

    if (!Array.isArray(inbounds) || inbounds.length === 0) {
        console.log('No inbounds found (or format differs).');
    } else {
        console.log(`Found ${inbounds.length} inbounds:`);
        inbounds.forEach(ib => {
            console.log(`ID: ${ib.id} | Tag: ${ib.tag} | Port: ${ib.port} | Protocol: ${ib.protocol}`);
        });
    }
})();
