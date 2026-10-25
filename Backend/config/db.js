const mongoose = require('mongoose');
require('dotenv').config();
const logger = require('./logger').createChildLogger('Database');

// Cache the in-flight or completed connection promise so concurrent callers
// share one mongoose.connect() attempt. Reset it on failure/disconnect so a
// later request can retry instead of reusing a rejected promise forever.
let connectionPromise = null;

function connectDB() {
    if (mongoose.connection.readyState === 1) {
        return Promise.resolve();
    }

    if (connectionPromise) {
        return connectionPromise;
    }

    if (!process.env.MONGO_URI) {
        return Promise.reject(new Error('MONGO_URI is not configured'));
    }

    connectionPromise = mongoose
        .connect(process.env.MONGO_URI, {
            serverSelectionTimeoutMS: 10000,
            maxPoolSize: 50 // Increased for high concurrency
        })
        .then(() => {
            logger.info('Database connected successfully');
            logger.info(`DB NAME: ${mongoose.connection.name}`);
        })
        .catch((error) => {
            connectionPromise = null;
            logger.error('Database connection failed', {
                error: error.message,
                errorName: error.name,
                errorCode: error.code
            });
            throw error;
        });

    return connectionPromise;
}

// Allow retries after the driver reports a dropped connection.
mongoose.connection.on('disconnected', () => {
    connectionPromise = null;
});

module.exports = connectDB;
