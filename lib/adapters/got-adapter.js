import RequestAdapter from './request-adapter.js';

class GotAdapter extends RequestAdapter {
    async getJson({ url, method = 'POST', body }) {
        return await this.client({
            method,
            url,
            json: body
        }).json();
    }
}

export default GotAdapter;