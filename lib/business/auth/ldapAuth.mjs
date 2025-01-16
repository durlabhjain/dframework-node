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
    isValid: true
};

// Todo this is untested code need to working in future
class LDAPAuth {
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

        await this.bind(ldapServiceUserDN, ldapServiceUserPassword);

        const searchOptions = {
            filter: `uid=${username}`,
            scope: 'sub'
        };

        const searchResults = await this.search(ldapPdc, searchOptions);

        if (!searchResults.length) {
            await this.unbind();
            throw new Error(`User not found: ${username}`);
        }

        const userDN = searchResults[0].objectName.toString();
        await this.bind(userDN, password);

        return {
            success: true,
            username,
            email: `${username}@${ldapPdc.replace('dc=', '').replace(',', '.')}`,
            groups: []
        };
    }
}

export default LDAPAuth;