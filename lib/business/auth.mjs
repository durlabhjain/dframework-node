import BasicAuth from './auth/basicAuth.mjs';
import EntraIdAuth from './auth/entraAuth.mjs';
import LdapAuth from './auth/ldapAuth.mjs';
import crypto from 'crypto';
import BusinessBase from './business-base.mjs';

const consts = {
    invalidPassword: "Invalid username or password"
}

/**
 * Authentication class that handles user authentication using different methods
 * including basic authentication, Entra ID, and LDAP.
 * @class
 */
class Auth {
    /**
     * Creates an instance of Auth.
     * Initializes SQL queries and authentication methods.
     * @constructor
     */
    constructor() {
        this.sql = BusinessBase.businessObject.sql;
        this.request = new BusinessBase().createRequest();
    }
    authMethods = {
        basicAuth: () => new BasicAuth(this),
        entraIdAuth: () => new EntraIdAuth(this),
        ldapAuth: () => new LdapAuth(this)
    };
    queries = {
        getUser: "SELECT su.Username, su.EmailAddress, su.RoleId, su.UserId, su.PasswordHash, su.DashboardPreference FROM Security_User su JOIN Security_Role ru ON su.RoleId = ru.RoleId WHERE su.EmailAddress=@_username AND su.IsActive=1;",
        getMenu: "SELECT * FROM vwRoleMenuList WHERE RoleId = @_roleId AND IsActive = 1;"
    };
    /**
     * Retrieves user information from the database based on username.
     * @param {string} username - The email address of the user
     * @returns {Promise<Object>} User object containing user details
     * @throws {Error} If user is not found
     */
    async getUserFromDatabase(username) {
        const { request } = this;
        const query = this.sql.addParameters({ query: this.queries.getUser, request, parameters: { _username: username }, forWhere: false });
        const user = await this.sql.runQuery({ request, type: 'query', query });
        if (!user.data.length) {
            throw new Error(`User not found: ${username}`);
        }
        return user.data[0];
    }

    /**
     * Retrieves menu data for a specific role.
     * @param {number} roleId - The ID of the role
     * @returns {Promise<Array>} Filtered menu data based on permissions
     */
    async getMenuData(roleId) {
        const { request } = this;
        const query = this.sql.addParameters({ query: this.queries.getMenu, request, parameters: { _roleId: roleId }, forWhere: false });
        const { data: menuData } = await this.sql.runQuery({ request, type: 'query', query });
        return menuData.filter(item => item.Permission1 !== 0);
    }

    /**
     * Hashes a password using SHA-256 algorithm.
     * @param {string} pwd - The password to hash
     * @returns {string} The hashed password in hexadecimal format
     */
    hashPassword(pwd) {
        const hash = crypto.createHash('sha256');
        hash.update(pwd);
        return hash.digest('hex');
    }

    /**
     * Authorizes a user using the specified authentication method.
     * @param {Object} params - The authorization parameters
     * @param {string} params.username - The username/email of the user
     * @param {string} params.password - The password of the user
     * @param {string} [params.methodKey="basicAuth"] - The authentication method to use
     * @param {Object} params.req - The request object
     * @param {Object} params.res - The response object
     * @param {Function} params.next - The next middleware function
     * @returns {Promise<Object>} The authorization result containing success status and message
     * @throws {Error} If the authorization fails
     */
    async authorize({ username, password, methodKey = "basicAuth", req, res, next }) {
        const authMethod = this.authMethods[methodKey]();
        try {
            const user = await authMethod.authenticate({ username, password, req, res, next });
            if (!user?.success) {
                return {
                    success: false,
                    message: consts.invalidPassword
                };
            }
            return { ...user };
        } catch (error) {
            return {
                success: false,
                message: error.message || consts.invalidPassword
            };
        }
    }
}

export default Auth;