import crypto from 'crypto';
import BusinessBase from '../business-base.mjs';

export default {
    /**
     * Retrieves a user from the database given the username.
     * @param {{ username: string }} params - The parameters.
     * @returns {Promise<object>} - The user details.
     * @throws {Error} - If the user is not found.
     */
    getUserFromDatabase: async function (username) {
        const sql = BusinessBase.businessObject.sql;
        const user = await sql.query(`SELECT su.Username, su.EmailAddress, su.RoleId, su.UserId, su.PasswordHash FROM Security_User su WHERE su.EmailAddress='${username}' AND su.IsActive=1 AND su.IsDeleted = 0;`);
        if (!user.length) {
            throw new Error(`User not found: ${username}`);
        }
        return user[0];
    },

    /**
     * Retrieves the menu list from the database given the roleId.
     * @param {{ roleId: number }} params - The parameters.
     * @returns {Promise<object[]>} - The menu list.
     */
    getMenuData: async function (roleId) {
        const sql = BusinessBase.businessObject.sql;
        const menuData = await sql.query(`SELECT * FROM vwRoleMenuList WHERE RoleId = ${roleId} AND IsActive = 1;`);
        return menuData.filter(item => item.Permission1 !== 0);
    },

    /**
     * Hashes a password using SHA-256.
     * @param {string} password - The password to hash.
     * @returns {string} - The hashed password.
     */
    hashPassword: function (password) {
        const hash = crypto.createHash('sha256');
        hash.update(password);
        return hash.digest('hex');
    }
}