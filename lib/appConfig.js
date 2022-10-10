import fs from 'fs-extra';

const readConfig = function (configFiles) {
    const config = {};

    configFiles.forEach((file) => {
        if (fs.existsSync(file)) {
            Object.assign(config, fs.readJSONSync(file));
        }
    });
    return config;
};

const appConfig = readConfig(['./config.json', './config.local.json']);

export { readConfig };

export default appConfig;