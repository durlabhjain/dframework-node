import aspxauth from 'aspxauth';
import BasicAuth from './basicAuth.mjs';
import crypto from 'crypto';
import util from '../../util.js';
import logger from '../../logger.js';
import config from '../../appConfig.mjs';
import BusinessBase from '../business-base.mjs';
import enums from '../../enums.mjs';

const { security: securityConfig } = config;

if (!securityConfig) {
    throw new Error("security config missing");
}

securityConfig.routes = securityConfig.routes || [];

for (const route of securityConfig.routes) {
    route.path = new RegExp(`^${route.path}`, 'i');
}

/**
 * User authentication and authorization class
 * 
 * This class can be extended by specific projects to customize behavior:
 * 
 * @example
 * // In your project, override the market functionality:
 * import { User } from '@durlabh/dframework/business/auth/aspxAuth';
 * 
 * // Enable markets globally for your project
 * User.getMarkets = true;
 * User.expectedRecordsets = 4; // userInfo, roles, modules, tags (markets will be +1)
 * 
 * // Or pass it per-call:
 * const user = await User.login({ 
 *   username, 
 *   password, 
 *   scopeId, 
 *   getMarkets: true 
 * });
 */
class User {

    isAuthenticated = false

    roles = {}

    modules = {}

    tags = {}

    /**
     * Static configuration that can be overridden by specific projects
     * Set to true if your stored procedure returns market data
     * @type {boolean}
     */
    static getMarkets = false;
    
    /**
     * Expected number of recordsets from Security_Login stored procedure
     * Default: 4 (userInfo, roles, modules, tags)
     * If getMarkets is true, markets recordset will be added automatically
     * @type {number}
     */
    static expectedRecordsets = enums.expectedRecordsets;

    static hashPassword(password) {
        const sha = crypto.createHash('sha1')
        sha.update(password)
        return sha.digest('hex');
    }

    static async login({ username, password, scopeId, withoutPassword = false, getMarkets = null }) {
        if (withoutPassword !== true && (typeof password !== 'string' || password.length < 5)) {
            return new User();
        }
        let passwordHash = "nothing";
        if (!withoutPassword) {
            passwordHash = User.hashPassword(password);
        }
        
        // Use parameter if provided, otherwise use static property
        const shouldGetMarkets = getMarkets !== null ? getMarkets : User.getMarkets;
        
        const parameters = {
            "Username": username,
            "ScopeId": Number(scopeId)
        };
        
        // Only add GetMarkets if it's true
        if (shouldGetMarkets) {
            parameters["GetMarkets"] = true;
        }
        
        if(!withoutPassword) {
            parameters["PasswordHash"] = passwordHash;
        }
        const result = await BusinessBase.businessObject.sql.execute({
            query: 'Security_Login',
            parameters
        });
        
        // Calculate expected recordsets based on configuration
        const expectedRecordsets = shouldGetMarkets ? User.expectedRecordsets + 1 : User.expectedRecordsets;
        
        if (result.recordsets?.length !== expectedRecordsets) {
            logger.warn(`Expected ${expectedRecordsets} recordsets, got ${result.recordsets?.length}`);
            return new User();
        }
        
        // Destructure based on whether markets are included
        let userInfo, roles, modules, tags, marketResult;
        if (shouldGetMarkets) {
            [[userInfo], roles, modules, tags, marketResult] = result.recordsets;
        } else {
            [[userInfo], roles, modules, tags] = result.recordsets;
        }

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

        // Only process market data if it was requested and returned
        if (shouldGetMarkets && marketResult) {
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
        }
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

const auth = () => {

    const validationKey = process.env.ASPX_VALIDATION_KEY;
    const decryptionKey = process.env.ASPX_DECRYPTION_KEY;

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
                user = await User.login({ username: decoded.name, scopeId, withoutPassword: true });
            } else {
                if (securitySettings.basicAuth === true) {
                    const credentials = new BasicAuth().auth(req);
                    if (credentials && credentials.user.length >= 5 && credentials.password.length >= 5) {
                        user = await User.login({ username: credentials.user, password: credentials.password, scopeId });
                    }
                }
            }
        } catch (err) {
            next(err);
            return;
        }
        /* if iUserMarket is added in config, apply UserMarket filters*/
        user.iUserMarket = securitySettings?.iUserMarket || false;
        util.req = { user };
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

class AspxAuth {
    constructor(auth) {
        this.auth = auth;
    }

    async authenticate({ username, password, props = {} }) {
        const scopeId = req.cookies?.ScopeId;
        const passwordHash = this.auth.hashPassword(password);
        const getMarkets = props.getMarkets !== undefined ? props.getMarkets : User.getMarkets;
        
        const parameters = {
            "Username": username,
            "ScopeId": Number(scopeId),
            "PasswordHash": passwordHash
        };
        
        // Only add GetMarkets if it's true
        if (getMarkets) {
            parameters["GetMarkets"] = true;
        }
        
        const result = await BusinessBase.businessObject.sql.execute({
            query: 'Security_Login',
            parameters
        });
        
        // Handle variable recordsets based on configuration
        const expectedRecordsets = getMarkets ? User.expectedRecordsets + 1 : User.expectedRecordsets;
        if (result.recordsets?.length !== expectedRecordsets) {
            logger.warn(`Expected ${expectedRecordsets} recordsets, got ${result.recordsets?.length}`);
            return { success: false, error: 'Unexpected recordset count' };
        }
        
        let userInfo, roles, modules, tags, marketResult;
        if (getMarkets) {
            [[userInfo], roles, modules, tags, marketResult] = result.recordsets;
        } else {
            [[userInfo], roles, modules, tags] = result.recordsets;
        }

        const tagDictionary = {};
        for (const tag of tags) {
            tagDictionary[tag.Key] = tag.Value;
        }

        const permissions = {};
        for (const module of modules) {
            permissions[module.Module] = module;
            permissions[module.ModuleId] = module;
        }

        const rolesDictionary = {};
        for (const role of roles) {
            rolesDictionary[role.Role] = role;
        }
        
        // Process market data if it was requested
        if (getMarkets && marketResult) {
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
        }
        
        tagDictionary.Username = username;
        return {
            userDetails: {
                id: userInfo.UserId,
                scopeId: userInfo.ScopeId,
                isInternal: userInfo.IsInternal,
                timezoneId: userInfo.TimeZoneId,
                tags: tagDictionary,
                user: userInfo,
                roles,
                // Only include market data if it was requested
                ...(getMarkets && marketResult ? { markets: marketResult } : {})
            },
            permissions,
            success: true
        };
    }
}

export { User, AspxAuth, auth };