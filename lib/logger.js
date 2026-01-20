import fse from 'fs-extra';
import pino from 'pino';
import { createWriteStream } from './pino-http-send.mjs';
import config from './appConfig.mjs';

const { logging: loggingConfigOverrides = {} } = config || {};

const { prettyPrint: prettyConfig = {}, file: fileConfig = {}, otherConfig = {}, customLevels = {} } = loggingConfigOverrides;

const loggingConfig = {
    postLevel: "error",
    stdout: true,
    logLevel: 'debug',
    logFolder: './logs',
    mixin: null,
    ...otherConfig
};

const prettyPrintConfig = {
    translateTime: 'SYS:yyyy-mm-dd h:MM:ss',
    ignore: '',
    colorize: false,
    singleLine: false,
    levelFirst: false,
    ...prettyConfig
};

const fileStreamConfig = {
    frequency: 'daily',
    limit: { count: 10 }, // keep 10 log files (equivalent to max_logs: '10d')
    size: '1m',
    extension: '.json',
    ...fileConfig
};

const { logFolder } = loggingConfig;
fse.ensureDirSync(logFolder);
const logLevel = loggingConfig.logLevel || loggingConfig.level || 'info';

// Parse file size from config (e.g., '1m' -> '1m', '10M' -> '10m')
const parseSize = (sizeStr) => {
    if (!sizeStr) return '10m';
    // pino-roll accepts sizes in format like '1m', '100k', '1g'
    return sizeStr.toLowerCase();
};

// Parse frequency from config
const parseFrequency = (freq) => {
    // pino-roll accepts 'daily', 'hourly', or milliseconds
    const frequencyMap = {
        'daily': 'daily',
        'hourly': 'hourly',
    };
    return frequencyMap[freq] || freq || 'daily';
};

// Helper function to create a pino-roll transport config
const createFileTransport = (level, fileName) => ({
    level,
    target: 'pino-roll',
    options: {
        file: `${logFolder}/${fileName}`,
        frequency: parseFrequency(fileStreamConfig.frequency),
        size: parseSize(fileStreamConfig.size),
        mkdir: true,
        extension: fileStreamConfig.extension,
        limit: fileStreamConfig.limit,
        symlink: true,
        dateFormat: 'yyyy-MM-dd',
    }
});

// Build transports array
const transports = [];

// Stdout transport with pretty printing (if enabled)
if (loggingConfig.stdout !== false) {
    transports.push({
        level: logLevel,
        target: 'pino-pretty',
        options: {
            destination: 1, // stdout
            customLevels: customLevels || undefined,
            ...prettyPrintConfig,
            colorize: true,
        }
    });
}

// File transports using pino-roll for log rotation
if (loggingConfig.logLevel !== 'error') {
    transports.push(createFileTransport(logLevel, 'log'));
}

// Error log file
transports.push(createFileTransport('error', 'error'));

// Slow query log file (custom level)
if (customLevels.slow !== undefined) {
    transports.push(createFileTransport('slow', 'slow'));
}

// Client error log file (custom level)
if (customLevels.clienterror !== undefined) {
    transports.push(createFileTransport('clienterror', 'client-error'));
}

// HTTP transport (if configured)
if (otherConfig.httpConfig) {
    const { httpConfig = {} } = otherConfig;
    transports.push({
        level: loggingConfig.postLevel || "error",
        target: './pino-http-send.mjs',
        options: {
            method: 'post',
            retries: 0,
            ...httpConfig
        }
    });
}

// Create logger with async transports for better performance
const logger = pino({
    level: logLevel, // this MUST be set at the lowest level of the destination
    customLevels: customLevels || undefined,
    mixin: loggingConfig.mixin || undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
}, pino.transport({
    targets: transports,
    // Use worker threads for transports to keep main thread responsive
    worker: { autoEnd: true }
}));

// Graceful shutdown handling to flush logs
const flushAndExit = (signal) => {
    logger.info(`Received ${signal}, flushing logs and exiting...`);
    // Flush the logger before exiting
    if (logger.flush) {
        logger.flush();
    }
    // Give some time for logs to flush
    setTimeout(() => {
        process.exit(0);
    }, 500);
};

// Handle common exit signals
process.on('SIGINT', () => flushAndExit('SIGINT'));
process.on('SIGTERM', () => flushAndExit('SIGTERM'));
process.on('beforeExit', () => {
    if (logger.flush) {
        logger.flush();
    }
});

export default logger;