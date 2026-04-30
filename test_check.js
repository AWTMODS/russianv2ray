require('dotenv').config();
const platega = require('./platega');

async function testCheck() {
    const res = await platega.checkPaymentStatus('00000000-0000-0000-0000-000000000000');
    console.log(JSON.stringify(res, null, 2));
}

testCheck();
