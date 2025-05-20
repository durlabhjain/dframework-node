class BasicAuth {
    constructor(auth) {
        this.auth = auth;
    }

    async authenticate({ username, password, req }) {
        const { userDetails, menuDetails } = req?.session?.user || {};
        const { email } = userDetails || {};
        // Check if user is logged in and email is present in session
        if (!username) {
            if (!email) {
                throw new Error(`Session Expired!`);
            };

            return {
                userDetails: {
                    email: email,
                    groups: userDetails.groups,
                    id: userDetails.id,
                    username: userDetails.username,
                    equipmentsList: userDetails.equipmentsList,
                    roleName: userDetails.roleName,
                    DashboardPreference: userDetails.DashboardPreference
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
                username: user.Username,
                email: user.EmailAddress,
                groups: roleId,
                id: user.UserId,
                roleName: user.RoleName,
                DashboardPreference: user.DashboardPreference
            },
            menuDetails: formateMenuData,
            success: true
        };
    }
}

export default BasicAuth;