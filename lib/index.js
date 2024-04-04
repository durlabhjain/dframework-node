import ListParameters from './list-parameters.js';
import got from 'got';
import { CookieJar } from 'tough-cookie';
import util from './util.js';
import Elastic from './elastic.js';
import Sql from './sql.js';
import fs from 'fs-extra';
import path from 'path';
import adapters from './adapters/index.js';
import BusinessBaseObjectsRouter from './business/business-objects.mjs';
import config from './appConfig.js';


class Controller {
    constructor(options) {
        Object.assign(this, options);
    }

    async list(listParameters) {
        const { framework, controller } = this;
        return framework.list({ controller, listParameters });
    }

    async listAll(listParameters) {
        const { framework, controller } = this;
        return framework.listAll({ controller, listParameters });
    }

    async get(params) {
        if (typeof params === 'number' || typeof params === 'string') {
            params = { id: params };
        }
        const { framework, controller } = this;
        return framework.query({ controller, params: { action: 'load', ...params } });
    }

    async save(id, params) {
        if (typeof id === 'object') {
            params = id;
        } else {
            params = { id: id, ...params };
        }
        const { framework, controller } = this;
        return framework.query({ controller, params: { action: 'save', ...params } });
    }
}

class Framework {

    constructor(options) {
        Object.assign(this, options);
        const cookieJar = new CookieJar();

        this.client = got.extend({ cookieJar, https: { rejectUnauthorized: config.httpsOptions.rejectUnauthorized } });
    }

    async setElastic(elasticConfig) {
        let elastic;
        if (elasticConfig) {
            let baseUrl
            if (elasticConfig.environment) {
                baseUrl = fs.readJsonSync(path.resolve('environments', elasticConfig.environment + '.esenv')).host;
            } else {
                baseUrl = null;
            }

            const requestAdapter = new adapters.request.Got(this.client);

            elastic = new Elastic({ baseUrl, requestAdapter });
        }
        this.elastic = elastic;
        return this;
    }

    async setSql(sqlConfig) {
        let sql;
        if (sqlConfig) {
            sql = new Sql();
            await sql.setConfig(sqlConfig);
        }
        this.sql = sql;
        return this;
    }

    loginInfo = undefined

    loginController = 'Login'

    serverUrl = 'https://portal.coolrgroup.com'

    logger = console

    controllers = {}

    async login(credentials) {
        const { loginController } = this;
        const loginInfo = await this.query({ controller: loginController, params: credentials });
        this.loginInfo = loginInfo;
        return loginInfo !== null && loginInfo.success === true;
    }

    getController(controller) {
        return new Controller({ controller, framework: this });
    }

    createControllers() {
        for (const name of arguments) {
            this.controllers[name] = this.getController(name);
        }
    }

    async query({ controller, params, method = "POST", ...options }) {
        const { serverUrl, client } = this;
        const url = `${serverUrl}/Controllers/${controller}.ashx`;

        if (params) {
            if (typeof params?.toFormData === 'function') {
                options.form = params.toFormData();
            } else {
                options.form = params;
            }
        }
        const result = await client({ url, method, ...options });
        if (result.statusCode === 200) {
            if (result.headers["content-type"].match(/^application\/json/i) ||
                result.body.startsWith('{') || result.body.startsWith('[')) {
                return JSON.parse(result.body);
            }
            return result.body;
        }
        return null;
    }

    async list({ controller, listParameters }) {
        const { logger } = this;
        logger.debug(`Fetching ${listParameters.limit} from ${listParameters.start}`);
        const data = await this.query({ controller, params: listParameters });
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
            const data = await this.query({ controller, params: listParameters });
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

    setBusinessBase({ router, businessObjectConfigs }) {
         new BusinessBaseObjectsRouter(router, businessObjectConfigs);
        return router;
    }
    ListParameters = ListParameters

    util = util

    static util = util
}

export default Framework;
