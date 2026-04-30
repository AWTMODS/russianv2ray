require('dotenv').config();
const axios = require('axios');

async function rawCheck() {
    try {
        const response = await axios.get(
            `https://app.platega.io/transaction/00000000-0000-0000-0000-000000000000`,
            {
                headers: {
                    'X-MerchantId': process.env.PLATEGA_MERCHANT_ID,
                    'X-Secret': process.env.PLATEGA_SECRET,
                    'Content-Type': 'application/json'
                }
            }
        );
        console.log(JSON.stringify(response.data, null, 2));
    } catch(e) {
        console.log(e.response ? JSON.stringify(e.response.data, null, 2) : e.message);
    }
}
rawCheck();
