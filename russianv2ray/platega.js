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

    /**
     * Create a payment transaction
     * @param {number} amount - Amount in rubles (will be converted to kopecks)
     * @param {string} description - Payment description
     * @param {string} userId - Telegram user ID
     * @param {string} returnUrl - URL to redirect after successful payment
     * @param {string} failedUrl - URL to redirect after failed payment
     * @returns {Promise<{success: boolean, paymentUrl?: string, transactionId?: string, error?: string}>}
     */
    async createPayment(amount, description, userId, returnUrl, failedUrl) {
        try {
            if (!this.merchantId || !this.secret) {
                return { success: false, error: 'Platega credentials not configured' };
            }

            // Convert rubles to kopecks
            const amountInKopecks = Math.round(amount * 100);

            const payload = {
                paymentMethod: 'card', // Can also be 'sbp' for Fast Payment System
                paymentDetails: {
                    amount: amountInKopecks,
                    currency: 'RUB'
                },
                description: description,
                externalId: `user_${userId}_${Date.now()}`, // Unique transaction ID
                returnUrl: returnUrl || `${process.env.WEBHOOK_BASE_URL}/payment/success`,
                failedUrl: failedUrl || `${process.env.WEBHOOK_BASE_URL}/payment/failed`,
                callbackUrl: `${process.env.WEBHOOK_BASE_URL}/webhook/platega`,
                metadata: {
                    userId: userId,
                    timestamp: new Date().toISOString()
                }
            };

            const response = await axios.post(
                `${this.baseUrl}/api/v1/transactions`,
                payload,
                {
                    headers: {
                        'X-MerchantId': this.merchantId,
                        'X-Secret': this.secret,
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (response.data && response.data.paymentUrl) {
                return {
                    success: true,
                    paymentUrl: response.data.paymentUrl,
                    transactionId: response.data.transactionId || response.data.id,
                    externalId: payload.externalId
                };
            } else {
                return {
                    success: false,
                    error: 'Invalid response from Platega API'
                };
            }
        } catch (error) {
            console.error('Platega payment creation error:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.message || error.message
            };
        }
    }

    /**
     * Check payment status
     * @param {string} transactionId - Platega transaction ID
     * @returns {Promise<{success: boolean, status?: string, error?: string}>}
     */
    async checkPaymentStatus(transactionId) {
        try {
            if (!this.merchantId || !this.secret) {
                return { success: false, error: 'Platega credentials not configured' };
            }

            const response = await axios.get(
                `${this.baseUrl}/api/v1/transactions/${transactionId}`,
                {
                    headers: {
                        'X-MerchantId': this.merchantId,
                        'X-Secret': this.secret
                    }
                }
            );

            if (response.data) {
                return {
                    success: true,
                    status: response.data.status,
                    data: response.data
                };
            } else {
                return {
                    success: false,
                    error: 'Invalid response from Platega API'
                };
            }
        } catch (error) {
            console.error('Platega status check error:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.message || error.message
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
            return true; // Allow webhooks if secret not configured (not recommended for production)
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
            externalId: webhookData.externalId,
            status: webhookData.status,
            amount: webhookData.amount,
            currency: webhookData.currency,
            userId: webhookData.metadata?.userId,
            timestamp: webhookData.timestamp || new Date().toISOString()
        };
    }
}

module.exports = new PlategaPaymentService();
