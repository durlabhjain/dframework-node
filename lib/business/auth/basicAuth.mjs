import authUtils from './auth-utils.mjs';
const { getUserFromDatabase, hashPassword, getMenuData } = authUtils;

class BasicAuth {
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
                },
                menuDetails,
                success: true
            };
        };

        const user = await getUserFromDatabase(username);
        const hashedPassword = hashPassword(password);

        if (hashedPassword !== user.PasswordHash) {
            throw new Error(`Invalid password.`);
        }

        const roleId = user.RoleId;
        const formateMenuData = await getMenuData(roleId);

        return {
            userDetails: {
                username: user.Username,
                email: user.EmailAddress,
                groups: roleId,
                id: user.UserId
            },
            menuDetails: formateMenuData,
            success: true
        };
    }
}

export default BasicAuth;