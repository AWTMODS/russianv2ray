<<<<<<< HEAD
/**
 * Utility functions for data formatting
 */
const utils = {
    formatBytes: (bytes, decimals = 2) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    },

    formatUsage: (usage) => {
        const used = utils.formatBytes(usage.used);
        const total = utils.formatBytes(usage.total);
        const percent = ((usage.used / usage.total) * 100).toFixed(1);
        return `📊 Usage Report\nUsed: ${used}\nTotal: ${total}\nProgress: ${percent}%\nExpires: ${usage.expiry}`;
    }
};

module.exports = utils;
=======
/**
 * Utility functions for data formatting
 */
const utils = {
    formatBytes: (bytes, decimals = 2) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    },

    formatUsage: (usage) => {
        const used = utils.formatBytes(usage.used);
        const total = utils.formatBytes(usage.total);
        const percent = ((usage.used / usage.total) * 100).toFixed(1);
        return `📊 Usage Report\nUsed: ${used}\nTotal: ${total}\nProgress: ${percent}%\nExpires: ${usage.expiry}`;
    }
};

module.exports = utils;
>>>>>>> 0b6771299652b90c6ba67f73ccd4bb1a0e57a8bb
