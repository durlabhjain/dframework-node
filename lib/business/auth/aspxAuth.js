import aspxauth from 'aspxauth';

class AspxAuth {
    constructor(auth) {
        this.auth = auth;
    }

    setUpAspxAuth({ validationKey = process.env.ASPX_VALIDATION_KEY, decryptionKey = process.env.ASPX_DECRYPTION_KEY }) {
        const validationMethod = "sha1";
        const decryptionMethod = "aes";
        this.aspxClient = aspxauth({
            validationMethod,
            validationKey,
            decryptionMethod,
            decryptionKey,
            mode: 'dotnet45'
        });
        return this.aspxClient;
    }

    async authenticate({ username, password, props = {} }) {
        const scopeId = req.cookies?.ScopeId;
        const passwordHash = this.auth.hashPassword(password);
        const result = await this.auth.sql.query(
            this.auth.queries.getSecurityUser,
            {
                where: [
                    { fieldName: "Username", operator: "=", value: username },
                    { fieldName: "ScopeId", operator: "=", value: scopeId },
                    { fieldName: "PasswordHash", operator: "=", value: passwordHash }]
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

export default AspxAuth;