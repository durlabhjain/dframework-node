import crypto from 'crypto';
import BusinessBase from '../business-base.mjs';

class Auth {
    async getUserFromDatabase(username) {
        const sql = BusinessBase.businessObject.sql;
        const request = new BusinessBase().createRequest();
        let query = `SELECT su.Username, su.EmailAddress, su.RoleId, su.UserId, su.PasswordHash, ru.Name AS RoleName FROM Security_User su JOIN Security_Role ru ON su.RoleId = ru.RoleId WHERE su.EmailAddress=@_username AND su.IsActive=1;`;
        query = sql.addParameters({ query: query, request, parameters: { _username: username }, forWhere: false });
        const user = await sql.runQuery({ request, type: 'query', query });
        if (!user.data.length) {
            throw new Error(`User not found: ${username}`);
        }
        return user.data[0];
    }
    async getMenuData(roleId) {
        const sql = BusinessBase.businessObject.sql;
        const menuData = await sql.query(`SELECT * FROM vwRoleMenuList WHERE RoleId = ${roleId} AND IsActive = 1;`);
        return menuData.filter(item => item.Permission1 !== 0);
    }
    hashPassword(pwd) {
        const hash = crypto.createHash('sha256');
        hash.update(pwd);
        return hash.digest('hex');
    }
};

export default Auth;