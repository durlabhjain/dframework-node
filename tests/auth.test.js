import { } from 'dotenv/config';
import { util, httpAuth } from '../index.js';
import { Buffer } from 'buffer';

const { BearerAuth, BasicAuth } = httpAuth;

const bearerAuth = new BearerAuth({
    requestOptions: {
        form: {
            grant_type: process.env.TOKEN_GRANT_TYPE,
            username: process.env.TOKEN_USERNAME,
            password: process.env.TOKEN_PASSWORD,
        }
    },
    token: 'dummy',
    url: process.env.TOKEN_URL,
    tokenKey: process.env.TOKEN_KEY
});

let result = await util.request({
    authentication: bearerAuth,
    method: 'POST',
    url: process.env.UPLOAD_URL,
    body: () => {
        return util.toFormData({
            "file": Buffer.from(JSON.stringify("{}"))
        })
    }
});

console.log({ statusCode: result.statusCode, body: result.body });

const basicAuth = new BasicAuth({
    username: process.env.BASIC_USERNAME,
    password: process.env.BASIC_PASSWORD
});

result = await util.request({
    authentication: basicAuth,
    method: 'POST',
    url: process.env.BASIC_AUTH_TEST_URL,
    form: {
        "action": 'list'
    }
});

console.log({ statusCode: result.statusCode, body: result.body });
