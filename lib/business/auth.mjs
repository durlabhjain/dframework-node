import BasicAuth from './auth/basicAuth.mjs';
import EntraIdAuth from './auth/entraAuth.mjs';
import LdapAuth from './auth/ldapAuth.mjs';

const authMethods = {
    basicAuth: () => new BasicAuth(),
    entraIdAuth: () => new EntraIdAuth(),
    ldapAuth: () => new LdapAuth()
};

class Auth {
    /**
     * Authorises a user using the specified method.
     * @param {{ username: string, password: string, methodKey?: string, req: any, res: any, next: any }} params - The parameters.
     * @returns {Promise<object>} - The authorisation result.
     * @throws {Error} - If the authorisation fails.
     */
    async authorise({ username, password, methodKey = "basicAuth", req, res, next }) {

        const authMethod = authMethods[methodKey]();

        try {
            const user = await authMethod.authenticate({ username, password, req, res, next });
            if (!user || !user?.success) {
                return {
                    success: false,
                    message: `Invalid username or password`
                };
            }
            return { ...user };
        } catch (error) {
            return {
                success: false,
                message: error.message || "Invalid username or password"
            };
        }
    }

    /**
     * Retrieves the configuration for Microsoft Authentication Library (MSAL)
     * @param {{ req: any, res: any, next: any }} params - The parameters.
     * @returns {Promise<object>} - The MSAL configuration.
     * @throws {Error} - If there is an error retrieving the configuration.
     */
    async getMsalConfig(req) {
        const entraIdAuth = new EntraIdAuth();
        try {
            return await entraIdAuth.getMsalConfig(req);
        } catch (error) {
            return {
                success: false,
                message: error.message || "Invalid username or password"
            };
        }
    }

    /**
     * Retrieves the configuration for Microsoft Authentication Library (MSAL) using the EntraID service.
     * @param {{ req: any, res: any, next: any }} params - The parameters.
     * @returns {Promise<object>} - The MSAL configuration.
     * @throws {Error} - If there is an error retrieving the configuration.
     */
    async getEntraLogin(req) {
        const entraIdAuth = new EntraIdAuth();
        try {
            return await entraIdAuth.entraLogin(req);
        } catch (error) {
            return {
                success: false,
                message: error.message || "token mismatch or session expired"
            };
        }
    }
}

export default Auth;