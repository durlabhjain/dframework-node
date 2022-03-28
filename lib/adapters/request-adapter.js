class RequestAdapter {
    constructor(client) {
        this.client = client;
    }

    async getJson({ url, method = 'POST', body }) {
        throw new Error('Not implemented');
    }
}

export default RequestAdapter;