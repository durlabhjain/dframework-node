import Auth from './auth.mjs';

class BasicAuth extends Auth {
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
                    DashboardSortModel: userDetails.DashboardSortModel
                },
                menuDetails,
                success: true
            };
        };

        const user = await this.getUserFromDatabase(username);
        const passwordHash = this.hashPassword(password);

        if (passwordHash !== user.PasswordHash) {
            throw new Error(`Invalid password.`);
        }

        const roleId = user.RoleId;
        const formateMenuData = await this.getMenuData(roleId);

        return {
            userDetails: {
                username: user.Username,
                email: user.EmailAddress,
                groups: roleId,
                id: user.UserId,
                roleName: user.RoleName,
                DashboardSortModel: user.DashboardSortModel
            },
            menuDetails: formateMenuData,
            success: true
        };
    }
}

export default BasicAuth;