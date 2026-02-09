require('dotenv').config();
const platega = require('./platega');

/**
 * Test script for Platega payment integration
 * This script creates a test payment and displays the payment URL
 */

async function testPaymentCreation() {
    console.log('🧪 Testing Platega Payment Integration\n');
    console.log('Configuration:');
    console.log(`- Merchant ID: ${process.env.PLATEGA_MERCHANT_ID ? '✓ Set' : '✗ Not set'}`);
    console.log(`- Secret: ${process.env.PLATEGA_SECRET ? '✓ Set' : '✗ Not set'}`);
    console.log(`- Base URL: ${process.env.PLATEGA_BASE_URL || 'https://app.platega.io'}`);
    console.log(`- Webhook URL: ${process.env.WEBHOOK_BASE_URL || 'Not set'}\n`);

    if (!process.env.PLATEGA_MERCHANT_ID || !process.env.PLATEGA_SECRET) {
        console.error('❌ Error: Platega credentials not configured in .env file');
        console.log('\nPlease add the following to your .env file:');
        console.log('PLATEGA_MERCHANT_ID=your_merchant_id');
        console.log('PLATEGA_SECRET=your_secret_key');
        console.log('PLATEGA_WEBHOOK_SECRET=your_webhook_secret');
        console.log('WEBHOOK_BASE_URL=https://your-domain.com');
        process.exit(1);
    }

    try {
        console.log('Creating test payment for 180₽...\n');

        const result = await platega.createPayment(
            180,
            'Portal VPN - Test Payment - 1 месяц',
            'test_user_123',
            `${process.env.WEBHOOK_BASE_URL}/payment/success`,
            `${process.env.WEBHOOK_BASE_URL}/payment/failed`
        );

        if (result.success) {
            console.log('✅ Payment created successfully!\n');
            console.log('Payment Details:');
            console.log(`- Transaction ID: ${result.transactionId}`);
            console.log(`- External ID: ${result.externalId}`);
            console.log(`- Payment URL: ${result.paymentUrl}\n`);
            console.log('📋 You can test the payment by opening this URL in your browser:');
            console.log(result.paymentUrl);
        } else {
            console.error('❌ Payment creation failed:');
            console.error(`Error: ${result.error}`);
        }
    } catch (error) {
        console.error('❌ Test failed with error:');
        console.error(error);
    }
}

testPaymentCreation();
