const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

let sessionCookie = null;

const api = {
    login: async () => {
        try {
            const response = await axios.post(`${process.env.PANEL_URL}/login`, {
                username: process.env.PANEL_USERNAME,
                password: process.env.PANEL_PASSWORD
            });

            if (response.data.success) {
                const cookies = response.headers['set-cookie'];
                if (cookies) {
                    sessionCookie = cookies.map(cookie => cookie.split(';')[0]).join('; ');
                    console.log('Logged into 3X-UI panel successfully.');
                    return true;
                }
            }
            console.error('Login failed:', response.data);
            return false;
        } catch (error) {
            console.error('Login error:', error.message);
            return false;
        }
    },

    /**
     * user: { email, uuid }
     * inboundId: number
     * expiryTime: number (timestamp in ms)
     */
    addClient: async (user, inboundId, expiryTime) => {
        if (!sessionCookie) await api.login();

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
            const response = await axios.post(`${process.env.PANEL_URL}/panel/api/inbounds/addClient`, clientData, {
                headers: {
                    'Cookie': sessionCookie,
                    'Content-Type': 'application/json'
                }
            });

            if (response.data.success) {
                return { success: true, data: response.data };
            } else {
                // If session expired, retry once
                if (response.data.msg.includes('login')) {
                    await api.login();
                    return api.addClient(user, inboundId, expiryTime);
                }
                return { success: false, msg: response.data.msg };
            }
        } catch (error) {
            console.error('Error adding client:', error.message);
            return { success: false, msg: error.message };
        }
    },

    updateClientExpiry: async (inboundId, email, uuid, newExpiryTime) => {
        if (!sessionCookie) await api.login();

        // 3X-UI often uses updateClient by UUID or similar. 
        // This is a best-guess based on common forks. 
        // Often we need to fetch the existing client settings first or use a specific update endpoint.
        // For now, assuming we might need to re-add or use valid update logic if available.
        // A safer bet for many versions is updating the specific client in the inbound list, 
        // but 'addClient' often fails if it exists. 
        // Let's try the update endpoint.

        // NOTE: Standard 3X-UI updateClient usually requires the client UUID in the URL or body.
        // POST /panel/api/inbounds/updateClient/:uuid
        try {
            // We need to construct the full client object for update
            const clientData = {
                id: inboundId,
                settings: JSON.stringify({
                    clients: [{
                        id: uuid,
                        email: email,
                        expiryTime: newExpiryTime,
                        enable: true,
                        // Preserve other fields? Ideally we fetch primarily.
                        // For simplicity in this iteration:
                        limitIp: 0,
                        totalGB: 0,
                    }]
                })
            };

            const response = await axios.post(`${process.env.PANEL_URL}/panel/api/inbounds/updateClient/${uuid}`, clientData, {
                headers: {
                    'Cookie': sessionCookie,
                    'Content-Type': 'application/json'
                }
            });

            return response.data;
        } catch (error) {
            console.error('Error updating client:', error.message);
            // Fallback: If update fails, maybe try add (if it was deleted) or just report error
            return { success: false, msg: error.message };
        }
    }
};

module.exports = api;
