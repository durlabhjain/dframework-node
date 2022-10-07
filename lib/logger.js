import fse from 'fs-extra';
import rfs from 'file-stream-rotator';
import pinoms from 'pino-multi-stream';
import { createWriteStream } from 'pino-http-send';
import config from './appConfig.js';

const { logging: loggingConfigOverrides = {} } = config || {};

const { prettyPrint: prettyConfig = {}, file: fileConfig = {}, otherConfig = {} } = loggingConfigOverrides;

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
    colorize: true,
    singleLine: false,
    levelFirst: false,
    ...prettyConfig
};

const fileStreamConfig = {
    frequency: '24h',
    verbose: false,
    max_logs: '10d',
    date_format: 'YYYY-MM-DD',
    size: '1m',
    ...fileConfig
};

function getStream({ level, dest, prettyPrint }) {
    return {
        level,
        stream: pinoms.prettyStream({ dest, prettyPrint }),
    };
}

const { logFolder } = loggingConfig;
fse.ensureDir(logFolder);

const mainStream = rfs.getStream({ ...fileStreamConfig, filename: `${logFolder}/log-%DATE%.log` });
const errorStream = rfs.getStream({ ...fileStreamConfig, filename: `${logFolder}/error-%DATE%.log` });

const logLevel = loggingConfig.level || "info";

const streams = [
    getStream({ level: 'error', dest: errorStream, prettyPrint: { ...prettyPrintConfig, ...{ colorize: false } } })
];
if (loggingConfig.stdout !== false) {
    streams.push(getStream({ level: logLevel, dest: process.stdout, prettyPrint: prettyPrintConfig }));
}
if (loggingConfig.logLevel !== 'error') {
    streams.push(getStream({ level: logLevel, dest: mainStream, prettyPrint: { ...prettyPrintConfig, ...{ colorize: false } } }));
}

if (otherConfig.httpConfig) {
    const { httpConfig = {} } = otherConfig;
    streams.push({
        level: loggingConfig.postLevel || "error",
        console: false,
        stream: createWriteStream({
            method: 'post',
            retries: 0,
            ...httpConfig
        }),
    });
}

const logger = pinoms({
    streams,
    mixin: loggingConfig.mixin,
});

export default logger;
