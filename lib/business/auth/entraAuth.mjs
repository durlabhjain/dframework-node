import { ConfidentialClientApplication, CryptoProvider } from '@azure/msal-node';
import appConfig from '../../appConfig.js';
import enums from '../../enums.mjs'
import authUtils from './auth-utils.mjs';
const authConfig = appConfig.authConfig
const redirectUri = authConfig.authOptions.redirectUri;
const cryptoProvider = new CryptoProvider();
const { getUserFromDatabase, getMenuData } = authUtils;

class EntraIdAuth {
    constructor() {
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
            clientSecret: authConfig.authOptions.clientSecret
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
                knownAuthorities: [authConfig.policies.authorityDomain]
            }
        };

        // Create an MSAL ConfidentialClientApplication object
        this.clientApplication = new ConfidentialClientApplication(confidentialClientConfig);
    }

    /**
    * Prepares the auth code request parameters and initiates the first leg of auth code flow
    * by redirecting the app to the authorization code url.
    * @param req: Express request object
    * @param res: Express response object
    * @param next: Express next function
    * @param authCodeUrlRequestParams: parameters for requesting an auth code url
    * @param authCodeRequestParams: parameters for requesting tokens using auth code
    */
    async redirectToAuthCodeUrl({ req, authCodeUrlRequestParams, authCodeRequestParams }) {

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
            challenge: challenge
        };

        /**
         * By manipulating the request objects below before each request, we can obtain
         * auth artifacts with desired claims. For more information, visit:
         * https://azuread.github.io/microsoft-authentication-library-for-js/ref/modules/_azure_msal_node.html#authorizationurlrequest
         * https://azuread.github.io/microsoft-authentication-library-for-js/ref/modules/_azure_msal_node.html#authorizationcoderequest
         **/

        req.session.authCodeUrlRequest = {
            redirectUri,
            responseMode: 'form_post', // recommended for confidential clients
            codeChallenge: req.session.pkceCodes.challenge,
            codeChallengeMethod: req.session.pkceCodes.challengeMethod,
            prompt: authConfig.formOptions.prompt || 'none',
            ...authCodeUrlRequestParams
        };

        req.session.authCodeRequest = {
            redirectUri,
            code: "",
            ...authCodeRequestParams,
        };

        // Get url to sign user in and consent to scopes needed for application
        const authCodeUrlResponse = await this.clientApplication.getAuthCodeUrl(req.session.authCodeUrlRequest);
        if (!authCodeUrlResponse) {
            throw new Error('Auth Code URL not found');
        }
        return {
            success: true,
            redirectUri: authCodeUrlResponse
        }
    };

    async getRedirectToAuthUrl(req) {
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
                appStage: enums.APP_STAGES.SIGN_IN
            })
        );
        const authCodeUrlRequestParams = {
            authority: authConfig.authOptions.authority,
            state: state
        };

        const authCodeRequestParams = {

            /**
             * By default, MSAL Node will add OIDC scopes to the auth code url request. For more information, visit:
             * https://docs.microsoft.com/azure/active-directory/develop/v2-permissions-and-consent#openid-connect-scopes
             */
            scopes: authConfig.resourceApi.scopes
        };
        // trigger the first leg of auth code flow
        return this.redirectToAuthCodeUrl({ req, authCodeUrlRequestParams, authCodeRequestParams });
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

    async entraLogin(req) {
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
                req.session.methodKey = enums.authMethods.entraIdAuth;
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
        const user = await getUserFromDatabase(username);
        const roleId = user.RoleId;
        const menuData = await getMenuData(roleId);

        return {
            userDetails: {
                username: user.Username,
                email: user.EmailAddress,
                groups: roleId,
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

export default EntraIdAuth;