const axios = require('axios');
const crypto = require('crypto');

class PlategaPaymentService {
    constructor() {
        this.baseUrl = process.env.PLATEGA_BASE_URL || 'https://app.platega.io';
        this.merchantId = process.env.PLATEGA_MERCHANT_ID;
        this.secret = process.env.PLATEGA_SECRET;
        this.webhookSecret = process.env.PLATEGA_WEBHOOK_SECRET;

        if (!this.merchantId || !this.secret) {
            console.warn('⚠️ Platega credentials not configured. Payment functionality will be disabled.');
        }
    }

    buildHeaders() {
        return {
            'X-MerchantId': this.merchantId,
            'X-Secret': this.secret,
            'Content-Type': 'application/json'
        };
    }

    /**
     * Create a payment transaction
     * @param {number} amount - Amount in rubles (will be converted to kopecks)
     * @param {string} description - Payment description
     * @param {string} userId - Telegram user ID
     * @param {string} returnUrl - URL to redirect after successful payment
     * @param {string} failedUrl - URL to redirect after failed payment
     * @returns {Promise<{success: boolean, paymentUrl?: string, transactionId?: string, externalId?: string, error?: string}>}
     */
    async createPayment(amount, description, userId, returnUrl, failedUrl) {
        try {
            if (!this.merchantId || !this.secret) {
                return { success: false, error: 'Platega credentials not configured' };
            }

            const amountValue = Math.round(amount);

            const externalId = `user_${userId}_${Date.now()}`;

            // Platega expects enum value, not "card" string.
            const command = {
                paymentMethod: Number(process.env.PLATEGA_PAYMENT_METHOD || 2),
                paymentDetails: { amount: amountValue, currency: 'RUB' },
                description: description,
                payload: externalId,
                externalId: externalId,
                return: returnUrl || `${process.env.WEBHOOK_BASE_URL}/payment/success`,
                failedUrl: failedUrl || `${process.env.WEBHOOK_BASE_URL}/payment/failed`,
                callbackUrl: `${process.env.WEBHOOK_BASE_URL}/webhook/platega`,
                metadata: {
                    userId: userId,
                    timestamp: new Date().toISOString()
                }
            };

            let response;
            try {
                response = await axios.post(
                    `${this.baseUrl}/transaction/process`,
                    command,
                    { headers: this.buildHeaders() }
                );
            } catch (e) {
                // Some API variants require { command: {...} } wrapper.
                if (e.response && e.response.status === 400 && e.response.data && e.response.data.errors && e.response.data.errors.command) {
                    response = await axios.post(
                        `${this.baseUrl}/transaction/process`,
                        { command: command },
                        { headers: this.buildHeaders() }
                    );
                } else {
                    throw e;
                }
            }

            const data = (response && response.data) || {};
            const paymentUrl =
                data.redirect ||
                data.paymentUrl ||
                data.url ||
                (data.data && (data.data.redirect || data.data.paymentUrl || data.data.url));

            const transactionId =
                data.transactionId ||
                data.id ||
                (data.data && (data.data.transactionId || data.data.id));

            if (paymentUrl) {
                return {
                    success: true,
                    paymentUrl: paymentUrl,
                    transactionId: transactionId,
                    externalId: externalId
                };
            }

            return {
                success: false,
                error: `Invalid response from Platega API: ${JSON.stringify(data)}`
            };
        } catch (error) {
            const details = (error.response && error.response.data) || error.message;
            console.error('Platega payment creation error:', details);
            return {
                success: false,
                error: typeof details === 'string' ? details : JSON.stringify(details)
            };
        }
    }

    /**
     * Check payment status
     * @param {string} transactionId - Platega transaction ID
     * @returns {Promise<{success: boolean, status?: string, data?: object, error?: string}>}
     */
    async checkPaymentStatus(transactionId) {
        try {
            if (!this.merchantId || !this.secret) {
                return { success: false, error: 'Platega credentials not configured' };
            }

            const response = await axios.get(
                `${this.baseUrl}/transaction/${transactionId}`,
                { headers: this.buildHeaders() }
            );

            const data = (response && response.data) || {};
            const status = data.status || (data.data && data.data.status);

            if (data) {
                return {
                    success: true,
                    status: status,
                    data: data
                };
            }

            return {
                success: false,
                error: 'Invalid response from Platega API'
            };
        } catch (error) {
            const details = (error.response && error.response.data) || error.message;
            console.error('Platega status check error:', details);
            return {
                success: false,
                error: typeof details === 'string' ? details : JSON.stringify(details)
            };
        }
    }

    /**
     * Verify webhook signature
     * @param {object} payload - Webhook payload
     * @param {string} signature - Signature from webhook header
     * @returns {boolean}
     */
    verifyWebhookSignature(payload, signature) {
        if (!this.webhookSecret) {
            console.warn('⚠️ Webhook secret not configured. Skipping signature verification.');
            return true;
        }

        try {
            const payloadString = JSON.stringify(payload);
            const expectedSignature = crypto
                .createHmac('sha256', this.webhookSecret)
                .update(payloadString)
                .digest('hex');

            return crypto.timingSafeEqual(
                Buffer.from(signature),
                Buffer.from(expectedSignature)
            );
        } catch (error) {
            console.error('Webhook signature verification error:', error);
            return false;
        }
    }

    /**
     * Process webhook notification
     * @param {object} webhookData - Webhook payload
     * @returns {object} Processed webhook data
     */
    processWebhook(webhookData) {
        return {
            transactionId: webhookData.transactionId || webhookData.id,
            externalId: webhookData.externalId || webhookData.payload,
            status: webhookData.status,
            amount: webhookData.amount,
            currency: webhookData.currency,
            userId: webhookData.metadata && webhookData.metadata.userId,
            timestamp: webhookData.timestamp || new Date().toISOString()
        };
    }
}

module.exports = new PlategaPaymentService();
