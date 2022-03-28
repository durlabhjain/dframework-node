import RequestAdapter from './request-adapter.js';

class AxiosAdapter extends RequestAdapter {
    async getJson({ url, method = 'POST', body }) {
        const result = await this.client.request({
            method,
            url,
            data: body
        });
        if (result.status !== 200) {
            throw new Error(`Couldn't fetch data: ${result.status}`);
        }
        return result.data;
    }
}

export default AxiosAdapter;