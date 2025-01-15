import ldap from 'ldapjs';
import { ConfidentialClientApplication, CryptoProvider } from '@azure/msal-node';
import crypto from 'crypto';
import { promisify } from 'util';
import BusinessBase from './business-base.mjs';
import enums from '../enums.mjs';
import appConfig from '../appConfig.js';

const authConfig = appConfig.authConfig
const redirectUri = authConfig.authOptions.redirectUri;
const cryptoProvider = new CryptoProvider();

const clientConfig = {
    timeout: 2000,
    connectTimeout: 3000
};

const dummyConfig = {
    ldapHost: 'ldap://127.0.0.1',
    ldapPort: '389',
    ldapPdc: 'dc',
    ldapServiceUserDN: '',
    ldapServiceUserPassword: '',
    isValid: true
};

class AuthBase {
    /**
     * Retrieves a user from the database given the username.
     * @param {{ username: string }} params - The parameters.
     * @returns {Promise<object>} - The user details.
     * @throws {Error} - If the user is not found.
     */
    async getUserFromDatabase({ username }) {
        const sql = BusinessBase.businessObject.sql;
        const user = await sql.query(`SELECT su.Username, su.EmailAddress, su.RoleId, su.UserId, su.PasswordHash FROM Security_User su WHERE su.EmailAddress='${username}' AND su.IsActive=1 AND su.IsDeleted = 0;`);
        if (!user.length) {
            throw new Error(`User not found: ${username}`);
        }
        return user[0];
    }

    /**
     * Retrieves the menu list from the database given the roleId.
     * @param {{ roleId: number }} params - The parameters.
     * @returns {Promise<object[]>} - The menu list.
     */
    async getMenuFromDatabase({ roleId }) {
        const sql = BusinessBase.businessObject.sql;
        return await sql.query(`SELECT * FROM vwRoleMenuList WHERE RoleId = ${roleId} AND IsActive = 1;`);
    }

    /**
     * Hashes a password using SHA-256.
     * @param {string} password - The password to hash.
     * @returns {string} - The hashed password.
     */
    hashPassword(password) {
        const hash = crypto.createHash('sha256');
        hash.update(password);
        return hash.digest('hex');
    }

    /**
     * Filters the menu data to include only items with a non-zero Permission1 value.
     * @param {Array} menuData - The list of menu items to be filtered.
     * @returns {Array} - The filtered list of menu items.
     */

    formatMenuData(menuData) {
        return menuData.filter(item => item.Permission1 !== 0);
    }
}

class Auth extends AuthBase {
    constructor() {
        super();
    }

    /**
     * Authorises a user using the specified method.
     * @param {{ username: string, password: string, methodKey?: string, req: any, res: any, next: any }} params - The parameters.
     * @returns {Promise<object>} - The authorisation result.
     * @throws {Error} - If the authorisation fails.
     */
    async authorise({ username, password, methodKey = "basicAuth", req, res, next }) {

        const authMethods = {
            basicAuth: () => new BasicAuth(),
            entraIdAuth: () => new EntraIDAuth(),
            ldapAuth: () => new LDAPAuth()
        };

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
                message: error.message || error || "Invalid username or password"
            };
        }
    }

    /**
     * Retrieves the configuration for Microsoft Authentication Library (MSAL)
     * @param {{ req: any, res: any, next: any }} params - The parameters.
     * @returns {Promise<object>} - The MSAL configuration.
     * @throws {Error} - If there is an error retrieving the configuration.
     */
    async getMsalConfig({ req, res, next }) {
        const entraIdAuth = new EntraIDAuth();
        try {
            return await entraIdAuth.getMsalConfig({ req, res, next });

        } catch (error) {
            return {
                success: false,
                message: error.message || error || "Invalid username or password"
            };
        }
    }

    /**
     * Retrieves the configuration for Microsoft Authentication Library (MSAL) using the EntraID service.
     * @param {{ req: any, res: any, next: any }} params - The parameters.
     * @returns {Promise<object>} - The MSAL configuration.
     * @throws {Error} - If there is an error retrieving the configuration.
     */
    async getEntraLogin({ req, res, next }) {
        try {
            const entraIdAuth = new EntraIDAuth();
            const config = await entraIdAuth.entraLogin({ req, res, next });
            return config;
        } catch (error) {
            return {
                success: false,
                message: error.message || error || "Invalid username or password"
            };
        }
    }
}


class BasicAuth extends AuthBase {
    async authenticate({ username, password, req }) {
        const { userDetails, menuDetails } = req?.session?.user || {};
        const { email } = userDetails || {};
        if (!username) {
            if (!email) {
                return {
                    success: false,
                    message: 'Session Expired!',
                    user: {}
                };
            }
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

        const user = await this.getUserFromDatabase({ username });

        const hashedPassword = this.hashPassword(password);

        if (hashedPassword !== user.PasswordHash) {
            throw new Error(`Invalid password.`);
        }

        const roleId = user.RoleId;
        const menuData = this.formatMenuData(await this.getMenuFromDatabase({ roleId }));

        return {
            userDetails: {
                username: user.Username,
                email: user.EmailAddress,
                groups: user.RoleId,
                id: user.UserId
            },
            menuDetails: menuData,
            success: true
        };
    }
}

class LDAPAuth extends AuthBase {
    setLDAPClient({ ldapHost, ldapPort }) {
        this.client = ldap.createClient({
            url: `${ldapHost}:${ldapPort}`,
            ...clientConfig
        });
        this.bind = promisify(this.client.bind).bind(this.client);
        this.unbind = promisify(this.client.unbind).bind(this.client);
    }

    async search(baseDn, searchOptions) {
        return new Promise((resolve, reject) => {
            this.client.search(baseDn, searchOptions, (err, res) => {
                if (err) {
                    reject(new Error(`Search error: ${err.message}`));
                } else {
                    const entries = [];
                    res.on('searchEntry', (entry) => entries.push(entry));
                    res.on('end', () => resolve(entries));
                    res.on('error', (searchErr) => reject(new Error(`Search error: ${searchErr.message}`)));
                }
            });
        });
    }

    async authenticate({ username, password }) {
        const { ldapHost, ldapPort, ldapPdc, ldapServiceUserDN, ldapServiceUserPassword, isValid } = dummyConfig;
        this.setLDAPClient({ ldapHost, ldapPort });

        try {
            await this.bind(ldapServiceUserDN, ldapServiceUserPassword);

            const searchOptions = {
                filter: `uid=${username}`,
                scope: 'sub'
            };

            const searchResults = await this.search(ldapPdc, searchOptions);

            if (!searchResults.length) {
                await this.unbind();
                return { username: null, groups: [], email: '' };
            }

            const userDN = searchResults[0].objectName.toString();
            await this.bind(userDN, password);

            return {
                success: true,
                username,
                email: `${username}@${ldapPdc.replace('dc=', '').replace(',', '.')}`,
                groups: []
            };
        } catch (err) {
            throw new Error(err.message);
        } finally {
            await this.unbind();
        }
    }
}

class EntraIDAuth extends Auth {
    constructor() {
        super();
        this.clientApplication = null;
    }

/**
 * Initializes the EntraIDAuth class by setting up the MSAL ConfidentialClientApplication.
 * It first validates that the required configuration properties are defined in the config.
 * If any required properties are missing, an error is thrown.
 * Once validated, it constructs a configuration object for the MSAL client and initializes
 * the ConfidentialClientApplication with it.
 * 
 * @throws {Error} - If any required properties are missing in the configuration.
 */

    //
    async initialize() {
        const { authority } = authConfig.policies.authorities.signUpSignIn;

        // Required properties for validation
        const requiredProperties = {
            clientId: authConfig.authOptions.clientId,
            authority: authority,
            clientSecret: authConfig.authOptions.clientSecret,
        };

        // Identify missing properties
        const missingKeys = Object.keys(requiredProperties).filter((key) => !requiredProperties[key]);

        if (missingKeys.length) {
            // Construct and throw an error listing all missing properties
            throw new Error(`Missing required properties: ${missingKeys.join(", ")}. Please ensure they are defined in the config.`)
        }

        const confidentialClientConfig = {
            auth: {
                ...requiredProperties,
                knownAuthorities: [authConfig.policies.authorityDomain],
            },
            system: {
                loggerOptions: {
                    loggerCallback( message, containsPii) {
                        console.log(message);
                    },
                    piiLoggingEnabled: false,
                }
            }
        };

        // Create an MSAL ConfidentialClientApplication object
        this.clientApplication = new ConfidentialClientApplication(confidentialClientConfig);
    }

    /**
     * Generates a CSRF token, encodes the state parameter, and initiates the first leg of
     * the authorization code flow by redirecting the app to the authorization code url.
     * @param {Express.Request} req - Express request object
     * @param {Express.Response} res - Express response object
     * @param {Express.NextFunction} next - Express next function
     * @returns {Promise<void>}
     */
    async getToken(req, res, next) {
        req.session.csrfToken = cryptoProvider.createNewGuid();

        const state = cryptoProvider.base64Encode(
            JSON.stringify({
                csrfToken: req.session.csrfToken,
                redirectTo: '/users/profile'
            })
        );

        const authCodeUrlRequestParams = {
            state: state,
            scopes: ["User.Read", "Directory.Read.All", "Tenant.Read.All"],
        };

        const authCodeRequestParams = {
            scopes: ["User.Read", "Directory.Read.All", "Tenant.Read.All"],
        };

        return this.redirectToAuthCodeUrl(req, res, next, authCodeUrlRequestParams, authCodeRequestParams);
    };

    /**
    * Prepares the auth code request parameters and initiates the first leg of auth code flow
    * by redirecting the app to the authorization code url.
    * @param req: Express request object
    * @param res: Express response object
    * @param next: Express next function
    * @param authCodeUrlRequestParams: parameters for requesting an auth code url
    * @param authCodeRequestParams: parameters for requesting tokens using auth code
    */
    async redirectToAuthCodeUrl({req, authCodeUrlRequestParams, authCodeRequestParams}) {

        //checking the redirect url exists or not
        if (!redirectUri) {
            throw new Error('Redirect URI not found in configuration');
        }

        // Generate PKCE Codes before starting the authorization flow
        const { verifier, challenge } = await cryptoProvider.generatePkceCodes();

        // Set generated PKCE codes and method as session vars
        req.session.pkceCodes = {
            challengeMethod: 'S256',
            verifier: verifier,
            challenge: challenge,
        };

        /**
         * By manipulating the request objects below before each request, we can obtain
         * auth artifacts with desired claims. For more information, visit:
         * https://azuread.github.io/microsoft-authentication-library-for-js/ref/modules/_azure_msal_node.html#authorizationurlrequest
         * https://azuread.github.io/microsoft-authentication-library-for-js/ref/modules/_azure_msal_node.html#authorizationcoderequest
         **/

        req.session.authCodeUrlRequest = {
            redirectUri: redirectUri,
            responseMode: 'form_post', // recommended for confidential clients
            codeChallenge: req.session.pkceCodes.challenge,
            codeChallengeMethod: req.session.pkceCodes.challengeMethod,
            prompt: authConfig.formOptions.prompt || 'none',
            ...authCodeUrlRequestParams,
        };

        req.session.authCodeRequest = {
            redirectUri: redirectUri,
            code: "",
            ...authCodeRequestParams,
        };

        // Get url to sign user in and consent to scopes needed for application
        try {
            const authCodeUrlResponse = await this.clientApplication.getAuthCodeUrl(req.session.authCodeUrlRequest);
            return {
                success: true,
                redirectUri: authCodeUrlResponse
            }
        } catch (error) {
            throw new Error(error);
        }
    };

    async getMsalConfig({ req, res, next }) {
        // create a GUID for crsf
        req.session.csrfToken = cryptoProvider.createNewGuid();
        if (!this.clientApplication) {
            await this.initialize();
        }

        /**
         * The MSAL Node library allows you to pass your custom state as state parameter in the Request object.
         * The state parameter can also be used to encode information of the app's state before redirect.
         * You can pass the user's state in the app, such as the page or view they were on, as input to this parameter.
         */
        const state = cryptoProvider.base64Encode(
            JSON.stringify({
                csrfToken: req.session.csrfToken,
                appStage: enums.APP_STAGES.SIGN_IN,
            })
        );
        const authCodeUrlRequestParams = {
            authority: authConfig.authOptions.authority,
            state: state,
        };

        const authCodeRequestParams = {

            /**
             * By default, MSAL Node will add OIDC scopes to the auth code url request. For more information, visit:
             * https://docs.microsoft.com/azure/active-directory/develop/v2-permissions-and-consent#openid-connect-scopes
             */
            scopes: authConfig.resourceApi.scopes,
        };

        // trigger the first leg of auth code flow
        return this.redirectToAuthCodeUrl({req, authCodeUrlRequestParams, authCodeRequestParams});
    };

/**
 * Handles the EntraID login flow by exchanging the authorization code for tokens.
 * 
 * This function handles the final step in the OAuth 2.0 authorization code flow.
 * It validates the state and CSRF token, acquires tokens using the provided
 * authorization code, and stores them in the session.
 * 
 * @param {object} params - The parameters.
 * @param {Express.Request} params.req - Express request object containing the authorization code and state.
 * @param {Express.Response} params.res - Express response object.
 * @param {Express.NextFunction} params.next - Express next function.
 * 
 * @returns {Promise<object>} - Returns a promise that resolves to an object with a success status
 * and a redirect URI on success. Throws an error if the state or CSRF token is invalid, or if an error
 * occurs during token acquisition.
 * 
 * @throws {Error} - Throws an error if the state or CSRF token is invalid, or if token acquisition fails.
 */

    async entraLogin({ req }) {
        const responseData = req.body;

        if (!this.clientApplication) {
            await this.initialize();
        }

        if (!responseData.state || responseData.error) {
            throw new Error(!responseData.state ? 'State not found'
                : JSON.stringify({ error: responseData.error, description: responseData.error_description }));
        }

        // Read the state object and determine the stage of the flow
        const state = JSON.parse(cryptoProvider.base64Decode(responseData.state));

        if (state.csrfToken === req.session.csrfToken && state.appStage === enums.APP_STAGES.SIGN_IN) {
            req.session.authCodeRequest.code = responseData.code;
            req.session.authCodeRequest.codeVerifier = req.session.pkceCodes.verifier;
            try {
                const tokenResponse = await this.clientApplication.acquireTokenByCode(req.session.authCodeRequest);
                req.session.accessToken = tokenResponse.accessToken;
                req.session.idToken = tokenResponse.idToken;
                req.session.account = tokenResponse.account;
                req.session.methodKey = "entraIdAuth";
                req.session.isAuthenticated = true;
                const homepage = appConfig.homepageURL || '/';
                return {
                    success: true,
                    redirectUri: homepage
                };
            } catch (error) {
                throw new Error('Redirect URI not found in configuration');
            }
        } else {
            throw new Error('CSRF token mismatch');
        }
    };

    /**
     * Authenticates a user by username and returns user details and menu data
     * @param {Object} options - Object containing username
     * @param {string} options.username - Username
     * @returns {Object} - Object containing user details and menu data
     * @property {Object} userDetails - User details
     * @property {string} userDetails.username - Username
     * @property {string} userDetails.email - Email address
     * @property {number} userDetails.groups - User role ID
     * @property {number} userDetails.id - User ID
     * @property {Object} menuDetails - Menu data
     */
    async authenticateUser({ username }) {
        const user = await this.getUserFromDatabase({ username });
        const roleId = user.RoleId;
        const menuData = this.formatMenuData(await this.getMenuFromDatabase({ roleId }));

        return {
            userDetails: {
                username: user.Username,
                email: user.EmailAddress,
                groups: user.RoleId,
                id: user.UserId
            },
            menuDetails: menuData
        };
    }

    /**
     * Authenticates a user based on session information and returns user details and menu data.
     *
     * This function checks the session for user details and idToken claims. If the user's email
     * is not found, it throws a session expired error. If user data is not available in the session,
     * it attempts to authenticate the user by their email. Throws an error if the user is not authorized.
     *
     * @param {Object} params - An object containing request and response objects.
     * @param {Express.Request} params.req - Express request object containing session data.
     * @param {Express.Response} params.res - Express response object.
     *
     * @returns {Promise<Object>} - A promise that resolves to an object with a success status and user data.
     *
     * @throws {Error} - Throws an error if the session is expired or if the user is not authorized.
     */

    async authenticate({ req, res }) {

        let userData = req?.session?.user;
        const { idTokenClaims = {} } = req?.session?.account ?? {};
        const { preferred_username: email } = idTokenClaims;

        if (!email) {
            throw new Error('Session Expired!');
        }

        if (!userData) {
            userData = await this.authenticateUser({ username: email });
            if (!userData) {
                throw new Error(`You (${email}) are not authorized to access the application. Please contact the administrator or log out of your Microsoft account and try again.`);
            }
        };

        return { success: true, ...userData };
    }
}

export default Auth;