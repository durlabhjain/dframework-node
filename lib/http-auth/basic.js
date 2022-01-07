class BasicAuthentication {
    constructor(options) {
        Object.assign(this, options);
    }

    getAuthorizationHeader() {
        const { username, password } = this;
        if (typeof username === 'string' && username.length > 0 && typeof password === 'string' && password.length > 0) {
            return "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
        }
        return null;
    }
}

export default BasicAuthentication;