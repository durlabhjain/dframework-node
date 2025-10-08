import { Buffer } from 'buffer'

class BasicAuth {
    constructor(auth) {
        this.auth = auth;
        this.USER_PASS_REGEXP = /^([^:]*):(.*)$/;
        this.CREDENTIALS_REGEXP = /^ *(?:[Bb][Aa][Ss][Ii][Cc]) +([A-Za-z0-9._~+/-]+=*) *$/
    }

    async authenticate({ username, password, req }) {
        const { userDetails } = req?.session?.user || {};
        const { email, id, user: userFromUserDetails } = userDetails || {};
        // Check if user is logged in and email is present in session
        if (!username) {
            if (!email || !id) {
                return {
                    success: false,
                    message: "Session Expired!"
                };
            };

            return {
                userDetails,
                permissions: await this.auth.getPermissions([userFromUserDetails.RoleId]),
                success: true
            };
        };
        if (!password) {
            return {
                success: false,
                message: "Password is needed to login."
            };
        }
        const user = await this.auth.getUserFromDatabase(username);
        const passwordHash = this.auth.hashPassword(password);
        if (passwordHash !== user.PasswordHash) {
            return {
                success: false,
                message: "Please enter correct password."
            };
        }

        return {
            userDetails: {
                user,
                username: user.Username,
                email: user.EmailAddress,
                id: user.UserId
            },
            success: true
        };
    }
    
    /**
     * Parse the Authorization header field of a request.
     *
     * @param {object} req
     * @return {object} with .user and .password
     * @public
     */
    
    auth(req) {
        if (!req) {
            throw new TypeError('argument req is required')
        }
    
        if (typeof req !== 'object') {
            throw new TypeError('argument req is required to be an object')
        }
    
        if (!req.headers || typeof req.headers !== 'object') {
            throw new TypeError('argument req is required to have headers property')
        }
    
        // get header
        const header = req.headers.authorization
    
        // parse header
        return this.parse(header)
    }
    
    /**
     * Parse basic auth to object.
     *
     * @param {string} string
     * @return {object}
     * @public
     */
    
    parse(string) {
        if (typeof string !== 'string') {
            return undefined
        }
    
        // parse header
        const match = this.CREDENTIALS_REGEXP.exec(string)
    
        if (!match) {
            return undefined
        }
    
        // decode user pass
        const decoded = Buffer.from(match[1], 'base64').toString();
        const userPass = this.USER_PASS_REGEXP.exec(decoded)
    
        if (!userPass) {
            return undefined
        }
    
        // return credentials object
        return {
            user: userPass[1],
            password: userPass[2]
        };
    }
    
}

export default BasicAuth;