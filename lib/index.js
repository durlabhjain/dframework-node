import ListParameters from './list-parameters.js';
import got from 'got';
import { CookieJar } from 'tough-cookie';
import util from './util.js';

class Framework {

    constructor(options) {
        Object.assign(this, options);
        const cookieJar = new CookieJar();

        this.client = got.extend({ cookieJar });
    }

    loginInfo = undefined

    serverUrl = 'https://portal.coolrgroup.com'

    logger = console

    controllers = {
        "login": 'login'
    }

    async login(credentials) {
        const { controllers } = this;
        const loginInfo = await this.query(controllers.login, credentials);
        this.loginInfo = loginInfo;
        return loginInfo !== null && loginInfo.success === true;
    }

    async query(controller, params, method = "POST") {
        const { serverUrl, client } = this;
        const url = `${serverUrl}/Controllers/${controller}.ashx`;
        let result;
        if (method === "POST") {
            if (typeof params?.toFormData === 'function') {
                params = params.toFormData();
            }
            result = await client.post(url, { form: params });
        } else {
            result = await client({ url, form: params, method });
        }
        if (result.statusCode === 200) {
            return result.headers["content-type"].match(/^application\/json/i) ? JSON.parse(result.body) : result.body;
        }
        return null;
    }

    async list({ controller, listParameters }) {
        let recordCount;
        const { logger } = this;
        logger.debug(`Fetching ${listParameters.limit} from ${listParameters.start}`);
        const data = await this.query(controller, listParameters);
        if (data === null || typeof data.recordCount !== 'number') {
            throw new Error("Couldn't fetch data");
        }
        return data;
    }

    async listAll({ controller, listParameters }) {
        let recordCount;
        const { logger } = this;
        const items = [];
        while (true) {
            logger.debug(`Fetching ${listParameters.limit} from ${listParameters.start} of ${recordCount}`);
            const data = await this.query(controller, listParameters);
            if (data === null || typeof data.recordCount !== 'number') {
                throw new Error("Couldn't fetch data");
            }

            recordCount = data.recordCount;

            const records = data.records;

            items.push(...records);

            if (items.length === recordCount || records.length < listParameters.limit) {
                break;
            }

            listParameters.start += listParameters.limit;
        }
        return { items, recordCount };
    }

    ListParameters = ListParameters

    util = util
};

export default Framework;
