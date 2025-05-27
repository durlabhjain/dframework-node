class BasicAuth {
    constructor(auth) {
        this.auth = auth;
    }

    async authenticate({ username, password, req }) {
        const { userDetails, menuDetails } = req?.session?.user || {};
        const { email, id } = userDetails || {};
        // Check if user is logged in and email is present in session
        if (!username) {
            if (!email || !id) {
                throw new Error(`Session Expired!`);
            };

            return {
                userDetails: {
                    ...userDetails,
                    email,
                    id
                },
                menuDetails,
                success: true
            };
        };

        const user = await this.auth.getUserFromDatabase(username);
        const passwordHash = this.auth.hashPassword(password);
        if (passwordHash !== user.PasswordHash) {
            throw new Error(`Invalid password.`);
        }

        const roleId = user.RoleId;
        const formateMenuData = await this.auth.getMenuData(roleId);

        return {
            userDetails: {
                ...user,
                username: user.Username,
                email: user.EmailAddress,
                id: user.UserId
            },
            menuDetails: formateMenuData,
            success: true
        };
    }
}

export default BasicAuth;