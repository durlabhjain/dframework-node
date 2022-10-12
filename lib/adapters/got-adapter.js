import RequestAdapter from './request-adapter.js';

class GotAdapter extends RequestAdapter {
    async getJson({ url, method = 'POST', body, http2 = false }) {
        return await this.client({
            method,
            url,
            json: body,
            http2
        }).json();
    }
}

export default GotAdapter;