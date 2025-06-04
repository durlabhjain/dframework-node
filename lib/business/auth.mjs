import BasicAuth from './auth/basicAuth.mjs';
import EntraIdAuth from './auth/entraAuth.mjs';
import LdapAuth from './auth/ldapAuth.mjs';
import crypto from 'crypto';
import BusinessBase from './business-base.mjs';

const consts = {
    invalidPassword: "Invalid username or password",
    authTypes: {
        db: "DB",
        auth: "AUTHENTICATION",
        mapping: "MAPPING"
    }
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
        getUser: "SELECT su.* FROM Security_User su JOIN Security_Role ru ON su.RoleId = ru.RoleId WHERE su.EmailAddress=@_email AND su.IsActive=1;",
        getPermissions: "SELECT * FROM vwRoleMenuList WHERE RoleId IN (@_roleIds) AND IsActive = 1;",
        getRoleIdsByName: "SELECT RoleId FROM Security_Role WHERE Name IN (@_roleNames) AND IsDeleted = 0;",
    };
    /**
     * Retrieves user information from the database based on username.
     * @param {string} email - The email address of the user
     * @returns {Promise<Object>} User object containing user details
     * @throws {Error} If user is not found
     */
    async getUserFromDatabase(email) {
        const { request } = this;
        const query = this.sql.addParameters({ query: this.queries.getUser, request, parameters: { _email: email }, forWhere: false });
        const user = await this.sql.runQuery({ request, type: 'query', query });
        if (!user.data.length) {
            throw new Error(`User not found: ${email}`);
        }
        return user.data[0];
    }

    /**
     * Retrieves menu data for a specific role.
     * @param {number} roleId - The ID of the role
     * @returns {Promise<Array>} Filtered menu data based on permissions
     */
    async getPermissions(roleId) {
        const roleIds = Array.isArray(roleId) && roleId.length ? roleId.join(",") : roleId;
        const { request } = this;
        const query = this.sql.addParameters({ query: this.queries.getPermissions, request, parameters: { _roleIds: roleIds }, forWhere: false });
        const { data: permissions } = await this.sql.runQuery({ request, type: 'query', query });
        return permissions.filter(item => item.Permission1 !== 0);
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
     * Gets roles and permissions based on provided parameters
     * @param {Object} params - Parameters for role/permission lookup
     * @param {number} [params.user] - Current user
     * @param {string[]} [params.groups] - LDAP groups for authentication
     * @param {string[]} [params.roles] - Role names for mapping
     * @returns {Promise<{ roleId: number | number[], permissions: Array }>}
     */
    async getRolesAndPermissions({ user, groups, roles }) {
        if (user) {
            return {
                roleId: user.RoleId,
                permissions: await this.getPermissions(user.RoleId)
            };
        }
        const roleNames = groups || roles || "";
        if (!roleNames.length) {
            throw new Error('No valid parameters provided for fetching role and permissions.');
        }
        const { request } = this;
        const query = this.sql.addParameters({ query: this.queries.getRoleIdsByName, request, parameters: { _roleNames: roleNames }, forWhere: false });
        const { data } = await this.sql.runQuery({ request, type: 'query', query });
        const roleIds = data.map(({ RoleId }) => RoleId);
        if (!roleIds.length) {
            throw new Error('No matching roles found for the user.');
        }
        return {
            roleId: roleIds.length === 1 ? roleIds[0] : roleIds,
            permissions: await this.getPermissions(roleIds)
        };
    }

    /**
     * Gets role and permissions based on authentication type
     * @param {Object} params - Parameters object
     * @param {string} params.email - Email to look up
     * @param {string[]} params.groups - Array of LDAP group names
     * @returns {Promise<{roleId: number, permissions: Array}>} Role ID and permissions
     * @throws {Error} If authentication type is invalid or user not found
     */
    async getRoleAndPermissionsByAuthType({ email, groups }) {
        const { authTypes } = consts;
        const { authType = authTypes.db } = config;
        switch (authType.toUpperCase()) {
            case authTypes.db:
                const user = await this.getUserFromDatabase(email);
                if (!user) {
                    throw new Error(`User not found in database: ${email}`);
                }
                return await this.getRolesAndPermissions({ user });

            case authTypes.auth:
                return await this.getRolesAndPermissions({ groups });

            case authTypes.mapping:
                const roleLookup = config.roleMapping || {};
                const roles = groups.map(g => roleLookup[g]).filter(Boolean);
                return await this.getRolesAndPermissions({ roles });

            default:
                throw new Error(`Invalid authentication type: ${authType}`);
        }

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
            return user;
        } catch (error) {
            return {
                success: false,
                message: error.message || consts.invalidPassword
            };
        }
    }
}

export default Auth;