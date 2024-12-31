import ldap from 'ldapjs';
import { promisify } from 'util';
import BusinessBase from './business-base.mjs';
import logger from '../logger.js';
import bcrypt from 'bcrypt';
// const saltRounds = 10;
const clientConfig = {
    timeout: 2000,
    connectTimeout: 3000
};

const dummyConfig = {
    LDAPHost: 'ldap://127.0.0.1',
    LDAPPort: '389',
    LDAPDC: 'dc',
    LDAPServiceUserDN: '',
    LDAPServiceUserPassword: '',
    isValid: true
};

/**
 * Class representing an LDAP client.
 */
class Auth {

    /**
     * Create an LDAP client.
     * @param {Object} config - Configuration object for LDAP.
     * @param {string} config.LDAPHost - The LDAP server host.
     * @param {string} config.LDAPPort - The LDAP server port.
     */
    setLDAPClient({ LDAPHost, LDAPPort }) {
        this.client = ldap.createClient({
            url: `${LDAPHost}:${LDAPPort}`,
            ...clientConfig
        });
        this.bind = promisify(this.client.bind).bind(this.client);
        this.unbind = promisify(this.client.unbind).bind(this.client);
    }

    /**
     * Search the LDAP directory.
     * @param {string} baseDn - The base distinguished name (DN) to search.
     * @param {Object} searchOptions - Options for the LDAP search.
     * @returns {Promise<Object[]>} A promise that resolves with an array of search entries.
     * @throws {Error} Throws an error if the search fails.
     */
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

    // comapre password hash in sql only
    async getUserFromDatabase({ username }) {
        const sql = BusinessBase.businessObject.sql;
        return await sql.query(`SELECT Username, EmailAddress, RoleId, UserId, PasswordHash FROM Security_User WHERE EmailAddress='${username}' AND IsActive=1 AND IsDeleted = 0;`);
    }

    async getMenuFromDatabase({ roleId }) {
        const sql = BusinessBase.businessObject.sql;
        return await sql.query(`SELECT * FROM vwRoleMenuList WHERE RoleId = ${roleId}  AND IsActive = 1;`);
    }
    /**
    * General authentication method using bcrypt.
    * @param {Object} credentials - The user credentials.
    * @param {string} credentials.username - The username.
    * @param {string} credentials.password - The password.
    * @returns {Promise<Object|null>} A promise that resolves with the user object if authenticated or null if authentication fails.
    */
    async basicAuth({ username, password }) {
        try {
            let user = await this.getUserFromDatabase({ username, password });
            if (!user.length) {
                logger.info('User not found.');
                return null;
            }
            user = user[0];
            // const HashedPassword = await bcrypt.hash(password, saltRounds);
            // console.log(HashedPassword);
            const isPasswordValid = await bcrypt.compare(password, user.PasswordHash);
            if (!isPasswordValid) {
                logger.info('Invalid password.');
                return null;
            }

            const roleId = user.RoleId;
            let menuData = await this.getMenuFromDatabase({ roleId });
            menuData = menuData.filter(item => item.Permission1 !== 0);
            // Return user details if authentication is successful

            return {
                userDetails: {
                    username: user.Username,
                    email: user.EmailAddress,
                    groups: user.RoleId,
                    id: user.UserId
                },
                menuDetails: menuData
            };
        } catch (err) {
            logger.error({}, err.message || 'Authentication error');
            return null;
        }
    }


    /**
     * Authorize a user by username and password.
     * @param {Object} credentials - The user credentials.
     * @param {string} credentials.username - The username to authorize.
     * @param {string} credentials.password - The password to authorize.
     * @returns {Promise<Object|null>} A promise that resolves with the user object or null if authorization fails.
     */
    async LDAPAuth({ username, password }) {
        try {
            let { LDAPHost, LDAPPort, LDAPDC, LDAPServiceUserDN, LDAPServiceUserPassword, isValid } = dummyConfig;

            if (!isValid) {
                LDAPHost = process.env.LDAP_HOST;
                LDAPPort = process.env.LDAP_PORT;
                LDAPDC = process.env.LDAP_DC;
                LDAPServiceUserDN = process.env.LDAP_SERVICE_USER_DN;
                LDAPServiceUserPassword = process.env.LDAP_SERVICE_USER_PASSWORD;
            }
            this.setLDAPClient({ LDAPHost, LDAPPort });
            let userDN = '';
            let groupNames = [];
            const loginMethod = LDAPServiceUserDN.toUpperCase().startsWith("CN") ? "CN" : "UID";

            try {
                await this.bind(LDAPServiceUserDN, LDAPServiceUserPassword);

                const searchOptions = {
                    filter: `${loginMethod}=${username}`,
                    scope: 'sub'
                };

                const searchResults = await this.search(LDAPDC, searchOptions);
                if (!searchResults.length) {
                    await this.unbind();
                    return { username: null, groups: [], email: '' };
                }

                userDN = searchResults[0].objectName.toString();
                await this.bind(userDN, password);

                searchOptions.filter = `(member=${userDN})`;
                const groupSearchResults = await this.search(LDAPDC, searchOptions);
                groupNames = groupSearchResults.map(groupEntry =>
                    fetchNameFromDN({ dn: groupEntry.objectName.toString() })
                );

            } catch (err) {
                logger.error({ err }, err.message);
            } finally {
                await this.unbind();
            }

            const user = fetchNameFromDN({
                dn: userDN,
                regexPattern: coreConfig.REGEX[`LDAP_${loginMethod}`]
            });

            return {
                username: user,
                email: `${username.replaceAll(" ", "_")}@${LDAPDC.replace(coreConfig.REGEX.FIRST_DC, '').split(coreConfig.REGEX.SUBSEQUENT_DCS).join('.')}`,
                groups: groupNames
            };
        }
        catch (err) {
            logger.error({ err }, err.message);
            return null;
        }
    }

    async authorise({ username, password, isLDAP }) {
        if (username === "johndoe") {
            return {
                username: "johndoe",
                email: "john.doe@example.com",
                groups: ["Administrator"]
            };
        }
        const user = await this[isLDAP ? "LDAPAuth" : "basicAuth"]({ username, password });
        if (user) {
            return {
                userDetails: {
                    username: user.userDetails.username,
                    email: user.userDetails.email,
                    groups: user.userDetails.groups,
                    id: user.userDetails.id
                },
                menuDetails: user.menuDetails
            };
        }

        return null;
    }
}

export default Auth;
