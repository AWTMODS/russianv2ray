const axios = require('axios');

/**
 * 3X-UI Panel API Client
 */
class PanelAPI {
    constructor() {
        this.sessionCookie = null;
        this.baseUrl = this.normalizeUrl(process.env.PANEL_URL);
        this.username = process.env.PANEL_USERNAME;
        this.password = process.env.PANEL_PASSWORD;
    }

    /**
     * Normalize panel URL
     * @param {string} url - Panel URL from environment
     * @returns {string} Normalized base URL
     */
    normalizeUrl(url) {
        let baseUrl = url.replace(/\/$/, '');
        if (baseUrl.endsWith('/panel')) {
            baseUrl = baseUrl.slice(0, -6);
        }
        return baseUrl;
    }

    /**
     * Login to 3X-UI panel
     * @returns {Promise<boolean>} Login success status
     */
    async login() {
        const loginUrl = `${this.baseUrl}/login`;
        console.log(`Attempting login to: ${loginUrl}`);

        try {
            const response = await axios.post(loginUrl, {
                username: this.username,
                password: this.password
            });

            if (response.data.success) {
                const cookies = response.headers['set-cookie'];
                if (cookies) {
                    this.sessionCookie = cookies.map(cookie => cookie.split(';')[0]).join('; ');
                    console.log('✅ Logged into 3X-UI panel successfully.');
                    return true;
                }
            }
            console.error('Login failed:', response.data);
            return false;
        } catch (error) {
            console.error(`Login error at ${loginUrl}:`, error.message);
            if (error.response) console.error('Status:', error.response.status);
            return false;
        }
    }

    /**
     * Add a client to an inbound
     * @param {Object} user - User object with email and uuid
     * @param {number} inboundId - Inbound ID
     * @param {number} expiryTime - Expiry timestamp in milliseconds
     * @returns {Promise<Object>} Result object
     */
    async addClient(user, inboundId, expiryTime) {
        if (!this.sessionCookie) {
            const loggedIn = await this.login();
            if (!loggedIn) return { success: false, msg: 'Login failed. Check server logs.' };
        }

        const addClientUrl = `${this.baseUrl}/panel/api/inbounds/addClient`;

        const clientData = {
            id: inboundId,
            settings: JSON.stringify({
                clients: [{
                    id: user.uuid,
                    email: user.email,
                    limitIp: 0,
                    totalGB: 0,
                    expiryTime: expiryTime,
                    enable: true,
                    tgId: '',
                    subId: ''
                }]
            })
        };

        try {
            const response = await axios.post(addClientUrl, clientData, {
                headers: {
                    'Cookie': this.sessionCookie,
                    'Content-Type': 'application/json'
                }
            });

            if (response.data.success) {
                return { success: true, data: response.data };
            } else {
                // If session expired, retry once
                if (response.data.msg && response.data.msg.includes('login')) {
                    console.log('Session expired, retrying login...');
                    await this.login();
                    return this.addClient(user, inboundId, expiryTime);
                }
                return { success: false, msg: response.data.msg };
            }
        } catch (error) {
            console.error(`Error adding client at ${addClientUrl}:`, error.message);
            if (error.response) console.error('Status:', error.response.status);
            return { success: false, msg: error.message };
        }
    }

    /**
     * Update client expiry time
     * @param {number} inboundId - Inbound ID
     * @param {string} email - Client email
     * @param {string} uuid - Client UUID
     * @param {number} newExpiryTime - New expiry timestamp
     * @returns {Promise<Object>} Result object
     */
    async updateClientExpiry(inboundId, email, uuid, newExpiryTime) {
        if (!this.sessionCookie) await this.login();

        try {
            const clientData = {
                id: inboundId,
                settings: JSON.stringify({
                    clients: [{
                        id: uuid,
                        email: email,
                        expiryTime: newExpiryTime,
                        enable: true,
                        limitIp: 0,
                        totalGB: 0,
                    }]
                })
            };

            const response = await axios.post(
                `${this.baseUrl}/panel/api/inbounds/updateClient/${uuid}`,
                clientData,
                {
                    headers: {
                        'Cookie': this.sessionCookie,
                        'Content-Type': 'application/json'
                    }
                }
            );

            return response.data;
        } catch (error) {
            console.error('Error updating client:', error.message);
            return { success: false, msg: error.message };
        }
    }

    /**
     * Get all inbounds from panel
     * @returns {Promise<Array>} Array of inbound objects
     */
    async getInbounds() {
        if (!this.sessionCookie) {
            const loggedIn = await this.login();
            if (!loggedIn) return [];
        }

        const listUrl = `${this.baseUrl}/panel/api/inbounds/list`;
        console.log(`Fetching inbounds from: ${listUrl}`);

        try {
            const response = await axios.get(listUrl, {
                headers: {
                    'Cookie': this.sessionCookie,
                    'Content-Type': 'application/json'
                }
            });

            if (response.data.success) {
                return response.data.obj;
            } else {
                console.error('Failed to list inbounds:', response.data);
                return [];
            }
        } catch (error) {
            console.error('Error fetching inbounds:', error.message);
            return [];
        }
    }
}

module.exports = new PanelAPI();
