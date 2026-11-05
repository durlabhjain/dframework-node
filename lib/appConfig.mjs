import { readConfig } from './config.mjs';

export { readConfig };
export default readConfig(['./config.json', './config.local.json']);
