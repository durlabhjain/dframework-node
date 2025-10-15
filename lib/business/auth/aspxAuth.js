class AspxAuth {
    constructor(auth) {
        this.auth = auth;
    }

    async authenticate({ username, password, props = {} }) {
        const scopeId = req.cookies?.ScopeId;
        const passwordHash = this.auth.hashPassword(password);
        const parameters = {
            "Username": username,
            "ScopeId": Number(scopeId),
            "PasswordHash": passwordHash
        };
        const result = await DFramework.sql.execute({
            query: 'Security_Login',
            parameters
        });
        const [[userInfo], roles, modules, tags, ...rest] = result.recordsets;

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
                ...rest
            },
            permissions,
            success: true
        };
    }
}
