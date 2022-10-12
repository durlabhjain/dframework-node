import RequestAdapter from './request-adapter.js';
import semver from 'semver';

class GotAdapter extends RequestAdapter {
    async getJson({ url, method = 'POST', body, http2 = semver.gte(process.version, '15.10.0') }) {
        return await this.client({
            method,
            url,
            json: body,
            http2
        }).json();
    }
}

export default GotAdapter;