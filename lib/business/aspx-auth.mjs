import aspxauth from 'aspxauth';
import crypto from 'crypto';
import appConfig from '../appConfig.js';
import { Buffer } from 'buffer';
import appUtils from '../appUtils.js';

const { security: securityConfig } = appConfig;

if (securityConfig && Array.isArray(securityConfig.routes) && securityConfig.routes.length > 0) {
    for (const route of securityConfig.routes) {
        if (typeof route.path === 'string') { 
            // Only convert if it's not already a RegExp
            try {
                route.path = new RegExp(`^${route.path}`, 'i');
            } catch (err) {
                console.error(`Error creating RegExp for path: ${route.path}`, err);
            }
        }
    }
}


/**
 * RegExp for basic auth credentials
 *
 * credentials = auth-scheme 1*SP token68
 * auth-scheme = "Basic" ; case insensitive
 * token68     = 1*( ALPHA / DIGIT / "-" / "." / "_" / "~" / "+" / "/" ) *"="
 * @private
 */

const CREDENTIALS_REGEXP = /^ *(?:[Bb][Aa][Ss][Ii][Cc]) +([A-Za-z0-9._~+/-]+=*) *$/

/**
 * RegExp for basic auth user/pass
 *
 * user-pass   = userid ":" password
 * userid      = *<TEXT excluding ":">
 * password    = *TEXT
 * @private
 */

const USER_PASS_REGEXP = /^([^:]*):(.*)$/

/**
 * Parse the Authorization header field of a request.
 *
 * @param {object} req
 * @return {object} with .name and .pass
 * @public
 */

function basicAuth(req) {
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
    return parse(header)
}

/**
 * Parse basic auth to object.
 *
 * @param {string} string
 * @return {object}
 * @public
 */

function parse(string) {
    if (typeof string !== 'string') {
        return undefined
    }

    // parse header
    const match = CREDENTIALS_REGEXP.exec(string)

    if (!match) {
        return undefined
    }

    // decode user pass
    const decoded = Buffer.from(match[1], 'base64').toString();
    const userPass = USER_PASS_REGEXP.exec(decoded)

    if (!userPass) {
        return undefined
    }

    // return credentials object
    return {
        user: userPass[1],
        password: userPass[2]
    };
}

class User {

    isAuthenticated = false

    roles = {}

    modules = {}

    tags = {}

    static hashPassword(password) {
        const sha = crypto.createHash('sha1')
        sha.update(password)
        return sha.digest('hex');
    }

    static async login({ username, password, scopeId, withoutPassword = false, dSql }) {
        if (withoutPassword !== true && (typeof password !== 'string' || password.length < 5)) {
            return new User();
        }
        let passwordHash = "nothing";
        if (!withoutPassword) {
            passwordHash = User.hashPassword(password);
        }
        const parameters = {
            "Username": username,
            "ScopeId": Number(scopeId),
            "GetMarkets": true
        };
        if(!withoutPassword) {
            parameters["PasswordHash"] = passwordHash;
        }
        const result = await dSql.execute({
            query: 'Security_Login',
            parameters
        });
        if (result.recordsets?.length !== 5) {
            return new User();
        }
        const [[userInfo], roles, modules, tags, marketResult] = result.recordsets;

        const user = new User();

        const tagDictionary = {};
        for (const tag of tags) {
            tagDictionary[tag.Key] = tag.Value;
        }

        const moduleDictionary = {};
        for (const module of modules) {
            moduleDictionary[module.Module] = module;
            moduleDictionary[module.ModuleId] = module;
        }

        const rolesDictionary = {};
        for (const role of roles) {
            rolesDictionary[role.Role] = role;
        }

        const MarketFilter = { enable: false, list: [] };
        const marketList = [];
        for (const market of marketResult) {
            marketList.push(market.MarketId)
        }
        if (marketList.length) {
            MarketFilter.list = marketList;
            MarketFilter.enable = true;
        }
        tagDictionary.MarketFilter = MarketFilter;
        tagDictionary.Username = username;
        Object.assign(user, {
            id: userInfo.UserId,
            scopeId: userInfo.ScopeId,
            isInternal: userInfo.IsInternal,
            timezoneId: userInfo.TimeZoneId,
            roles: rolesDictionary,
            modules: moduleDictionary,
            tags: tagDictionary,
        });
        return user;
    }

    isInRole(role) {
        return this.roles[role] !== undefined;
    }

    hasPermission(module, permission = 0) {
        const moduleInfo = this.modules[module];
        if (moduleInfo === undefined) {
            return false;
        }
        return moduleInfo.Permissions[permission] === '1';
    }
}

const aspxAuthMiddleWare = ({ validationKey, decryptionKey, dSql }) => {

    if (!validationKey || !decryptionKey) {
        throw new Error("Missing validationKey or decryptionKey");
    }

    const validationMethod = "sha1";
    const decryptionMethod = "aes";

    const decoder = aspxauth({
        validationMethod,
        validationKey,
        decryptionMethod,
        decryptionKey,
        mode: 'dotnet45'
    });

    return async (req, res, next) => {
        if (!securityConfig) {
                return res.status(500).json({ error: "Security config missing" });
        }
        const cookie = req.cookies ? req.cookies[".ASPXAUTH"] : undefined;
        const scopeId = req.cookies?.ScopeId;
        const securityPaths = securityConfig.routes.filter(route => route.path.test(req.path));
        req.securityPaths = securityPaths;

        /* If no paths match, we do not allow access */
        if (securityPaths.length === 0) {
            return res.status(401).send("Unauthorized");
        }

        let securitySettings = {};
        for (const path of securityPaths) {
            securitySettings = { ...securitySettings, ...path };
        }

        /* If anonymous access is allowed, skip authentication */
        if (securitySettings.anonymous === true) {
            return next();
        }

        /* Process authentication */
        let user = new User();
        let decoded;
        try {
            if (cookie) {
                try {
                    decoded = decoder.decrypt(cookie);
                } catch (err) {
                    logger.error(err);
                }
            }
            if (decoded) {
                user = await User.login({ username: decoded.name, scopeId, withoutPassword: true, dSql });
            } else {
                if (securitySettings.basicAuth === true) {
                    const credentials = basicAuth(req);
                    if (credentials && credentials.user.length >= 5 && credentials.password.length >= 5) {
                        user = await User.login({ username: credentials.user, password: credentials.password, scopeId, dSql });
                    }
                }
            }
        } catch (err) {
            next(err);
            return;
        }
        /* if iUserMarket is added in config, apply UserMarket filters*/
        user.iUserMarket = securitySettings?.iUserMarket || false;
        if(appUtils?.req) {
            appUtils.req = { user };
        }
        
        req.user = user;

        let isAuthorized = true;
        /* Authorization */
        // Check for internal
        if (securitySettings.isInternal === true && user.isInternal !== true) {
            isAuthorized = false;
        }

        // Check for roles
        if (isAuthorized && Array.isArray(securitySettings.roles)) {
            isAuthorized = false;
            for (const role of securitySettings.roles) {
                if (user.isInRole(role)) {
                    isAuthorized = true;
                    break;
                }
            }
        }

        if (isAuthorized && Array.isArray(securitySettings.permissions)) {
            isAuthorized = false;
            for (const permission of securitySettings.permissions) {
                if (user.hasPermission(permission)) {
                    isAuthorized = true;
                    break;
                }
            }
        }

        if (!isAuthorized) {
            return res.status(401).send("Unauthorized");
        }

        next();
    }
};

export default aspxAuthMiddleWare;