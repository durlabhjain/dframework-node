import fs from 'fs-extra';
import { pathToFileURL } from 'url';
import path from 'path';

const readUtils = function (utilsFiles) {
    const utils = {};

    utilsFiles.forEach((file) => {
        const fullPath = path.resolve(file);
        if (fs.existsSync(fullPath)) {
            import(pathToFileURL(fullPath).href).then((mod) => {
                Object.assign(utils, mod.default || mod);
            }).catch((err) => {
                return {};
            });
        }
    });

    return utils;
};

// Read the index.js file from the utils folder
const appUtils = readUtils(['./utils/index.js']);

export { readUtils };

export default appUtils;
