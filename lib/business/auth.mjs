import BasicAuth from './auth/basicAuth.mjs';
import EntraIdAuth from './auth/entraAuth.mjs';
import LdapAuth from './auth/ldapAuth.mjs';
import crypto from 'crypto';
import BusinessBase from './business-base.mjs';
import config from "../appConfig.mjs";

const consts = {
    invalidPassword: "Invalid username or password",
    roleSource: {
        db: "db",
        auth: "auth",
        mapping: "mapping"
    },
    basicAuth: "basicAuth",
    numberOfPermissions: 8
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
    }
    authMethods = {
        basicAuth: () => new BasicAuth(this),
        entraIdAuth: () => new EntraIdAuth(this),
        ldapAuth: () => new LdapAuth(this)
    };
    queries = {
        getUser: "SELECT su.* FROM Security_User su JOIN Security_Role ru ON su.RoleId = ru.RoleId WHERE su.EmailAddress=@_email AND su.IsActive=1;",
        getPermissions: "SELECT * FROM vwRoleMenuList WHERE RoleId IN ( SELECT CAST(value AS INT) FROM STRING_SPLIT(@_roleIds, ',')) AND IsActive = 1;",
        // getPermissions: "SELECT * FROM vwRoleMenuList WHERE RoleId IN (@_roleIds) AND IsActive = 1;",
        getRoleIdsByName: "SELECT RoleId FROM Security_Role WHERE Name IN (SELECT TRIM(value) FROM STRING_SPLIT(@_roleNames, ',')) AND IsDeleted = 0;",
    };
    /**
     * Retrieves user information from the database based on username.
     * @param {string} email - The email address of the user
     * @returns {Promise<Object>} User object containing user details
     * @throws {Error} If user is not found
     */
    async getUserFromDatabase(email) {
        const request = this.sql.createRequest();
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
        const roleIds = Array.isArray(roleId) && roleId.length ? roleId.join(",") : roleId.toString();
        const request = this.sql.createRequest();
        const query = this.sql.addParameters({ query: this.queries.getPermissions, request, parameters: { _roleIds: roleIds }, forWhere: false });
        const { data: permissions } = await this.sql.runQuery({ request, type: 'query', query });

        // Filter out permissions with Permission1 = 0
        const filtered = permissions.filter(item => item.Permission1 !== 0);

        const mergedPermissionsMap = new Map();

        for (const item of filtered) {
            const moduleId = item.ModuleId;

            if (!mergedPermissionsMap.has(moduleId)) {
                mergedPermissionsMap.set(moduleId, { ...item });
                continue;
            }

            const existing = mergedPermissionsMap.get(moduleId);

            // Merge each Permission1 to Permission8
            for (let i = 1; i <= consts.numberOfPermissions; i++) {
                const key = `Permission${i}`;
                existing[key] = Math.max(existing[key], item[key]);
            }

            // Recompute Permissions string
            existing.Permissions = Array.from({ length: consts.numberOfPermissions }, (_, i) => existing[`Permission${i + 1}`]).join('');
        }

        return Array.from(mergedPermissionsMap.values());
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
    async getRolesAndPermissions({ roleId, roles }) {
        if (roleId) {
            return {
                roleId,
                permissions: await this.getPermissions(roleId)
            };
        }
        roles = Array.isArray(roles) && roles.length ? roles.join(",") : (roles || "");
        if (!roles.length) {
            throw new Error('No valid parameters provided for fetching role and permissions.');
        }
        const query = this.sql.addParameters({ query: this.queries.getRoleIdsByName, request, parameters: { _roleNames: roles }, forWhere: false });
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
    async getRoleAndPermissionsByAuthType({ user, email, groups }) {
        const { roleSource } = consts;
        const { authType = roleSource.db } = config;
        switch (authType) {
            case roleSource.db:
                if (!user) {
                    user = await this.getUserFromDatabase(email);
                }
                if (!user) {
                    throw new Error(`User not found in database: ${email}`);
                }
                return await this.getRolesAndPermissions({ roleId: user.RoleId });

            case roleSource.auth:
                return await this.getRolesAndPermissions({ roles: groups });

            case roleSource.mapping:
                const roleLookup = config.roleMapping || {};
                const roles = [];
                groups.each(entry => {
                    const role = roleLookup[entry];
                    if (typeof role === 'string' && role.length > 0) roles.push(role);
                });
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
    async authorize({ username, password, methodKey = consts.basicAuth, req, res, next }) {
        const authMethod = this.authMethods[methodKey]();
        try {
            const authResult = await authMethod.authenticate({ username, password, req, res, next });
            if (!authResult?.success) {
                return {
                    success: false,
                    message: consts.invalidPassword
                };
            }
            const { userDetails = {} } = authResult;
            const { email, groups } = userDetails;
            const hasRoleId = "RoleId" in userDetails;
            const params = {
                email,
                groups
            }
            if (hasRoleId) {
                params.user = userDetails;
            }
            const { roleId, permissions } = await this.getRoleAndPermissionsByAuthType(params);
            if (!hasRoleId) {
                userDetails.RoleId = roleId;
            }
            return {
                userDetails,
                permissions,
                success: true
            };
        } catch (error) {
            return {
                success: false,
                message: error.message || consts.invalidPassword
            };
        }
    }
}

export default Auth;