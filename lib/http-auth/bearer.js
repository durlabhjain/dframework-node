import got from 'got';

class BearerAuthentication {

    /**
     * 
     * @param {Object} options 
     * @param {String} options.tokenKey - The key of the token in the response body
     * @param {String} options.url - The url of the token endpoint
     * @param {Object} options.requestOptions - The options of the request - headers, body, etc.
     * @param {String} options.token - The token to use (if not provided, will be retrieved from the token endpoint)
     */
    constructor(options) {
        Object.assign(this, options);
    }

    token = null

    logger = console

    tokenKey = 'token'

    url = null

    /**
     * @param {Boolean} mayRequireRenewal = true - if true, will get token from remote server
     */
    mayRequireRenewal = true

    async getAuthorizationHeader({ renew }) {
        if (renew) {
            this.token = null;
        }
        if (!this.token) {
            this.token = await this.getToken();
        }
        if (this.token) {
            return `Bearer ${this.token}`;
        }
        return null;
    }


    async getToken() {
        const { requestOptions, tokenKey, url, logger } = this;
        if (!requestOptions || !tokenKey || !url) {
            return;
        }
        try {
            const result = await got.post(url, requestOptions).json();
            return result[tokenKey];
        } catch (error) {
            logger.error(error.response.body);
            return null;
        }
    }
}

export default BearerAuthentication;