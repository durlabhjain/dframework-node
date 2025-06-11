class BasicAuth {
    constructor(auth) {
        this.auth = auth;
    }

    async authenticate({ username, password, req }) {
        const { userDetails } = req?.session?.user || {};
        const { email, id } = userDetails || {};
        // Check if user is logged in and email is present in session
        if (!username) {
            if (!email || !id) {
                throw new Error("Session Expired!");
            };

            return {
                userDetails,
                permissions: await this.auth.getPermissions(userDetails.RoleId),
                success: true
            };
        };
        if (!password) {
            throw new Error("Password is needed to login.");
        }
        const user = await this.auth.getUserFromDatabase(username);
        const passwordHash = this.auth.hashPassword(password);
        if (passwordHash !== user.PasswordHash) {
            throw new Error(`Please enter correct password.`);
        }

        return {
            userDetails: {
                ...user,
                username: user.Username,
                email: user.EmailAddress,
                id: user.UserId
            },
            success: true
        };
    }
}

export default BasicAuth;