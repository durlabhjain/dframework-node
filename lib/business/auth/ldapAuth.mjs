import ldap from 'ldapjs';
import { promisify } from 'util';
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
    isValid: false  // make it true for testing purpose
};

class LdapAuth {
    constructor(auth) {
        this.auth = auth;
    }
    /**
  * Create an ldap client.
  * @param {Object} config - Configuration object for ldap.
  * @param {string} config.ldapHost - The ldap server host.
  * @param {string} config.ldapPort - The ldap server port.
  */
    setLDAPClient({ ldapHost, ldapPort }) {
        this.client = ldap.createClient({
            url: `${ldapHost}:${ldapPort}`,
            ...clientConfig
        });
        // promisifying the bind and unbind fucntions and binding them back to `this.client`.
        // So as to have access of this in the promisified fucntion.
        this.bind = promisify(this.client.bind).bind(this.client);
        this.unbind = promisify(this.client.unbind).bind(this.client);
    }

    /**
     * Search the ldap directory.
     * @param {string} baseDn - The base distinguished name (DN) to search.
     * @param {Object} searchOptions - Options for the ldap search.
     * @returns {Promise<Object[]>} A promise that resolves with an array of search entries.
     * @throws {Error} Throws an error if the search fails.
     */
    async search(baseDn, searchOptions) {
        return new Promise((resolve, reject) => {
            this.client.search(baseDn, searchOptions, (err, res) => {
                if (err) {
                    throw (new Error(`Search error: ${err.message}`));
                } else {
                    const entries = [];
                    res.on('searchEntry', (entry) => entries.push(entry));
                    res.on('end', () => resolve(entries));
                    res.on('error', (searchErr) => reject(new Error(`Search error: ${searchErr.message}`)));
                }
            });
        });
    }

    /**
     * Authenticate a user with ldap.
     * @param {Object} options - An object with properties `username` and `password`.
     * @returns {Promise<Object>} - A promise that resolves with an object containing the user's ldap details.
     * @property {string} username - The username.
     * @property {string} email - The email address of the user.
     * @property {string[]} groups - The groups the user is a member of.
     * @throws {Error} Throws an error if the authentication fails.
     */
    async authenticate({ username, password }) {
        let { ldapHost, ldapPort, ldapDC, ldapServiceUserDN, ldapServiceUserPassword, isValid } = dummyConfig;
        if (!isValid) {
            ldapHost = process.env.ldap_HOST;
            ldapPort = process.env.ldap_PORT;
            ldapDC = process.env.ldap_DC;
            ldapServiceUserDN = process.env.ldap_SERVICE_USER_DN;
            ldapServiceUserPassword = process.env.ldap_SERVICE_USER_PASSWORD;
        }
        this.setLDAPClient({ ldapHost, ldapPort });
        let userDN = '';
        let groups = [];
        const loginMethod = ldapServiceUserDN.toUpperCase().startsWith("CN") ? "CN" : "UID";

        await this.bind(ldapServiceUserDN, ldapServiceUserPassword);

        const searchOptions = {
            filter: `${loginMethod}=${username}`,
            scope: 'sub'
        };

        const searchResults = await this.search(ldapDC, searchOptions);
        if (!searchResults.length) {
            await this.unbind();
            throw new Error(`User not found: ${username}`);
        }

        userDN = searchResults[0].objectName.toString();
        await this.bind(userDN, password);

        searchOptions.filter = `(member=${userDN})`;
        const groupSearchResults = await this.search(ldapDC, searchOptions);
        groups = groupSearchResults.map(groupEntry =>
            fetchNameFromDN({ dn: groupEntry.objectName.toString() })
        );

        const user = fetchNameFromDN({
            dn: userDN,
            regexPattern: coreConfig.REGEX[`LDAP_${loginMethod}`]
        });
        const email = `${username.replaceAll(" ", "_")}@${ldapDC.split(",").join('.')}`;

        return {
            userDetails: {
                username: user,
                email,
                groups
            },
            success: true
        }
    }

}

export default LdapAuth;