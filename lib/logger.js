import fse from 'fs-extra';
import pino from 'pino';
import config from './appConfig.mjs';

const { logging: loggingConfigOverrides = {} } = config || {};

const { prettyPrint: prettyConfig = {}, file: fileConfig = {}, otherConfig = {}, customLevels = {} } = loggingConfigOverrides;

const loggingConfig = {
    postLevel: "error",
    stdout: true,
    logLevel: 'info',
    logFolder: './logs',
    mixin: null,
    ...otherConfig
};

const prettyPrintConfig = {
    translateTime: 'SYS:yyyy-mm-dd h:MM:ss',
    ignore: '',
    colorize: true,
    singleLine: false,
    levelFirst: false,
    ...prettyConfig
};

const fileStreamConfig = {
    frequency: 'daily',
    limit: { count: 10 }, // keep 10 log files (equivalent to max_logs: '10d')
    size: '10m',
    extension: '.json',
    dateFormat: 'yyyy-MM-dd',
    ...fileConfig
};

const { logFolder } = loggingConfig;
fse.ensureDirSync(logFolder);
const logLevel = loggingConfig.logLevel || loggingConfig.level || 'info';

// Helper function to create a pino-roll transport config
const createFileTransport = (level, fileName) => ({
    level,
    target: 'pino-roll',
    options: {
        file: `${logFolder}/${fileName}${fileStreamConfig.extension}`,
        frequency: fileStreamConfig.frequency.toLowerCase(),
        size: fileStreamConfig.size,
        mkdir: true,
        limit: fileStreamConfig.limit,
        symlink: true,
        dateFormat: fileStreamConfig.dateFormat,
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
            customLevels: Object.keys(customLevels).length ? customLevels : undefined,
            ...prettyPrintConfig
        }
    });
}

// File transports using pino-roll for log rotation
if (logLevel !== 'error') {
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
    customLevels: Object.keys(customLevels).length ? customLevels : undefined,
    mixin: loggingConfig.mixin || undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
}, pino.transport({
    targets: transports,
    // Use worker threads for transports to keep main thread responsive
    worker: { autoEnd: true }
}));


const flushLogger = async () => {
    if (typeof logger.flush === 'function') {
        await new Promise((resolve) => {
            try {
                const result = logger.flush(() => resolve());
                // Support promise-returning flush implementations
                if (result && typeof result.then === 'function') {
                    result.then(() => resolve()).catch(() => resolve());
                }
            } catch {
                // On error, proceed with shutdown anyway
                resolve();
            }
        });
    } else {
        // Fallback: small delay to allow async transports to process the last logs
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
};

const flushAndExit = async (signal) => {
    logger.info(`Received ${signal}, flushing logs and exiting...`);
    try {
        await flushLogger();
    } finally {
        process.exit(0);
    }
};

// Handle common exit signals
process.on('SIGINT', () => {
    void flushAndExit('SIGINT');
});
process.on('SIGTERM', () => {
    void flushAndExit('SIGTERM');
});
process.on('beforeExit', () => {
    void flushLogger();
});

export default logger;