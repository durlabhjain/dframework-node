class BasicAuth {
    constructor(auth) {
        this.auth = auth;
    }

    async authenticate({ username, password, req }) {
        const { userDetails, permissions } = req?.session?.user || {};
        const { email, id } = userDetails || {};
        // Check if user is logged in and email is present in session
        if (!username) {
            if (!email || !id) {
                throw new Error(`Session Expired!`);
            };

            return {
                userDetails,
                permissions,
                success: true
            };
        };

        const user = await this.auth.getUserFromDatabase(username);
        const passwordHash = this.auth.hashPassword(password);
        if (passwordHash !== user.PasswordHash) {
            throw new Error(`Invalid password.`);
        }

        const formattedPermissions = await this.auth.getPermissions(user.RoleId);
        return {
            userDetails: {
                ...user,
                username: user.Username,
                email: user.EmailAddress,
                id: user.UserId
            },
            permissions: formattedPermissions,
            success: true
        };
    }
}

export default BasicAuth;