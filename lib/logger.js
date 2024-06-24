import fse from 'fs-extra';
import rfs from 'file-stream-rotator';
import pino, { multistream } from 'pino';
import pretty from 'pino-pretty';
import { createWriteStream } from './pino-http-send.mjs';
import config from './appConfig.js';

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
    max_logs: '10d',
    date_format: 'YYYY-MM-DD',
    size: '1m',
    extension: ".log",
    ...fileConfig
};

function getStream({ level, destination, prettyPrint }) {
    return {
        level,
        stream: pretty({ ...prettyPrint, destination }),
    };
}

const { logFolder } = loggingConfig;
fse.ensureDir(logFolder);
const logLevel = loggingConfig.level || 'info';

const mainStream = rfs.getStream({ ...fileStreamConfig, filename: `${logFolder}/log-%DATE%` });
const errorStream = rfs.getStream({ ...fileStreamConfig, filename: `${logFolder}/error-%DATE%` });
const slowStream = rfs.getStream({ ...fileStreamConfig, filename: `${logFolder}/slow-%DATE%` });

const streams = [
    getStream({ level: 'error', destination: errorStream, prettyPrint: prettyPrintConfig }),
    getStream({ level: 'slow', destination: slowStream, prettyPrint: { ...prettyPrintConfig } })
];
if (loggingConfig.stdout !== false) {
    streams.push(getStream({ level: logLevel, destination: process.stdout, prettyPrint: { ...prettyPrintConfig, colorize: true } }));
}
if (loggingConfig.logLevel !== 'error') {
    streams.push(getStream({ level: logLevel, destination: mainStream, prettyPrint: prettyPrintConfig }));
}

if (otherConfig.httpConfig) {
    const { httpConfig = {} } = otherConfig;
    streams.push({
        level: loggingConfig.postLevel || "error",
        console: false,
        stream: await createWriteStream({
            method: 'post',
            retries: 0,
            ...httpConfig
        }),
    });
}

const logger = pino({
    level: logLevel || 'info', // this MUST be set at the lowest level of the destination
    customLevels,
    mixin: loggingConfig.mixin
}, multistream(streams, { dedupe: true, levels: { ...pino.levels, ...customLevels } }));

export default logger;
