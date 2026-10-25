// Debug utility for conditional logging
const DEBUG = process.env.NEXT_PUBLIC_DEBUG === "true" || process.env.NEXT_PUBLIC_DEBUG === "1";

const debug = {
    error: (...args) => {
        if (DEBUG) {
            console.error(...args);
        }
    },

    info: (...args) => {
        if (DEBUG) {
            console.info(...args);
        }
    },
    log: (...args) => {
        if (DEBUG) {
            console.log(...args);
        }
    },

    warn: (...args) => {
        if (DEBUG) {
            console.warn(...args);
        }
    },
};

module.exports = debug;
