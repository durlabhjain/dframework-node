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

const { roleSource } = consts;
const { authType = roleSource.db } = config;

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
        getUser: "SELECT * FROM Security_User",
        getPermissions: "SELECT * FROM vwSecurity_RoleModule",
        getRoleIdsByName: "SELECT RoleId FROM Security_Role",
        getMenuDetails: "SELECT * FROM vwRoleMenuList",
    };
    /**
     * Retrieves user information from the database based on username.
     * @param {string} email - The email address of the user
     * @returns {Promise<Object> | null} User object containing user details
     */
    async getUserFromDatabase(email) {
        const user = await this.sql.query(this.queries.getUser, { where: [{ fieldName: "EmailAddress", value: email }, { fieldName: "IsActive", value: "1" }, { fieldName: "IsDeleted", value: "0" }] });
        if (!user.length) {
            return null;
        }
        return user[0];
    }

    /**
     * .
     * Retrieves menu data for a specific role.
     * @param {number} roleId - The ID of the role
     * @returns {Promise<Array>} Filtered menu data based on permissions
     */
    async getPermissions(roleIds) {
        const permissions = await this.sql.query(this.queries.getPermissions, { where: [{ fieldName: "RoleId", operator: "in", value: roleIds }] });
        const filtered = permissions.filter(item => item.Permission1 !== 0);

        return filtered;
    }

    async getMenuDetails(roleIds) {
        const menuDetails = await this.sql.query(this.queries.getMenuDetails, { where: [{ fieldName: "RoleId", operator: "in", value: roleIds }] });
        return menuDetails;
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
     */
    async authorize({ username, password, methodKey = consts.basicAuth, req, res, next, ...props }) {
        const authMethod = this.authMethods[methodKey]();
        try {
            const authResult = await authMethod.authenticate({ username, password, req, props });
            if (!authResult?.success) {
                return {
                    success: false,
                    message: authResult.message || consts.invalidPassword
                };
            }
            const { userDetails = {} } = authResult;
            let { permissions, menuDetails } = authResult;
            const { email, groups } = userDetails;
            let { user } = userDetails;

            if (!user) {
                user = await this.getUserFromDatabase(email);
                if (!user) {
                    return {
                        success: false,
                        message: `User not found in database: ${email}`
                    };
                }
            }
            if (!permissions || !menuDetails) {
                const roles = [];
                switch (authType) {
                    case roleSource.db:
                        roles.push(user.RoleId);
                        break;
                    case roleSource.auth:
                        const data = await this.sql.query(this.queries.getRoleIdsByName, {
                            where: [
                                { fieldName: "Name", operator: "in", value: groups },
                                { fieldName: "IsDeleted", value: "0" }
                            ]
                        });
                        roles.push(...data.map(({ RoleId }) => RoleId));
                        break;
                    case roleSource.mapping:
                        const roleLookup = config.roleMapping || {};
                        groups.forEach(entry => {
                            const role = roleLookup[entry];
                            Number.isInteger(role) && roles.push(role);
                        })
                        break;
                }

                if (!roles || roles.length === 0) {
                    return {
                        success: false,
                        message: 'No roles assigned to user'
                    };
                }
                if (!permissions) {
                    permissions = await this.getPermissions(roles);
                } 
                if (!menuDetails) {
                    menuDetails = await this.getMenuDetails(roles);
                }
            }

            return {
                userDetails,
                permissions,
                menuDetails,
                success: true
            };
        } catch (error) {
            return {
                success: false,
                message: error.message
            };
        }
    }
}

export default Auth;