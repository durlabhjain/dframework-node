import mssql from 'mssql';
import SqlHelper from './sql-helper.mjs';
import { sqlErrorMapper } from './error-mapper.mjs';

const enums = {
    startDateTime: '00:00:00',
    endDateTime: '23:59:59',
    UniqueKeyErrorCode: 2627,
    UniqueIndexErrorCode: 2601
}

const RelationshipTypes = {
    OneToMany: "OneToMany",
    OneToOne: "OneToOne"
}

const filterFields = {
    CreatedByUser: "Created_",
    ModifiedByUser: "Modified_"
}

const dateTimeEnum = {
    DateTime: 'dateTime',
    DateTimeLocal: 'dateTimeLocal'
}

const dateTypeFields = ["date", "dateTime", "dateTimeLocal"];

const IsDeletedColumn = "IsDeleted";

const compareLookups = {
    "contains": function ({ v, type }) {
        return { operator: 'LIKE', value: `%${v}%`, type: type };
    },
    "startsWith": function ({ v, type }) {
        return { operator: 'LIKE', value: `${v}%`, type: type };
    },
    "endsWith": function ({ v, type }) {
        return { operator: 'LIKE', value: `%${v}`, type: type };
    },
    "notContains": function ({ v, type }) {
        return { operator: 'NOT LIKE', value: `%${v}%`, type: type };
    },
    "=": function ({ v, type }) {
        return { operator: '=', value: v === '' ? null : v, type: type };
    },
    "!=": function ({ v, type }) {
        return { operator: '!=', value: v === '' ? null : v, type: type };
    },
    "isEmpty": function ({ type }) {
        return { operator: 'IS', value: "isEmpty", type: type };
    },
    "isNotEmpty": function ({ type }) {
        return { operator: 'IS NOT', value: "isNotEmpty", type: type };
    },
    ">": function ({ v, type }) {
        return { operator: '>', value: v, type: type };
    },
    "<": function ({ v, type }) {
        return { operator: '<', value: v, type: type };
    },
    ">=": function ({ v, type }) {
        return { operator: '>=', value: v, type: type };
    },
    "<=": function ({ v, type }) {
        return { operator: '<=', value: v, type: type };
    },
    "is": function ({ v, type }) {
        let toReturn = {};
        if (dateTypeFields.includes(type)) {
            let values = [];
            if (typeof v === 'object') {
                values = v;
            } else {
                for (let index = 0; index < 2; index++) {
                    const isFirstIndex = index === 0;
                    values.push(isFirstIndex ? `${v} ${enums.startDateTime}` : `${v} ${enums.endDateTime}`);
                }
            }
            if (type === dateTimeEnum.DateTimeLocal) {
                toReturn = { operator: 'DATETIME', value: v, sqlType: mssql.DateTime }
            } else {
                toReturn = { operator: 'BETWEEN', value: values, sqlType: mssql.VarChar, type: type };
            }
        } else {
            toReturn = { operator: '=', value: v, type: type };
        }
        return toReturn;
    },
    "not": function ({ v, type }) {
        if (dateTypeFields.includes(type)) {
            const values = [];
            for (let index = 0; index < 2; index++) {
                const isFirstIndex = index === 0;
                values.push(isFirstIndex ? `${v} ${enums.startDateTime}` : `${v} ${enums.endDateTime}`);
            }
            if (type === dateTimeEnum.DateTimeLocal) {
                return { operator: 'NOT BETWEEN DATE', value: v, sqlType: mssql.DateTime, type: type };
            }
            return { operator: 'NOT BETWEEN', value: values, sqlType: mssql.VarChar, type: type };
        } else {
            return { operator: '!=', value: v, type: type };
        }
    },
    "onOrAfter": function ({ v, type }) {
        if (type === dateTimeEnum.DateTimeLocal) {
            return { operator: '>=', value: `${v}`, type: type };
        }
        return { operator: '>=', value: `${v} ${enums.startDateTime}`, type: type };
    },
    "onOrBefore": function ({ v, type }) {
        if (type === dateTimeEnum.DateTimeLocal) {
            return { operator: '<=', value: `${v}`, type: type };
        }
        return { operator: '<=', value: `${v} ${enums.endDateTime}`, type: type };
    },
    "after": function ({ v, type }) {
        if (type === dateTimeEnum.DateTimeLocal) {
            return { operator: '>', value: `${v}`, type: type };
        }
        return { operator: '>', value: `${v} ${enums.endDateTime}`, type: type };
    },
    "before": function ({ v, type }) {
        if (type === dateTimeEnum.DateTimeLocal) {
            return { operator: '<', value: `${v}`, type: type };
        }
        return { operator: '<', value: `${v} ${enums.startDateTime}`, type: type };
    },
    "isAnyOf": function ({ v, type }) {
        return { operator: 'IN', value: v, sqlType: mssql.VarChar, type: type };
    },
    "isTrue": function () {
        return { operator: '=', value: true };
    },
    "isFalse": function () {
        return { operator: '=', value: false };
    },
    "isToday": function () {
        return { operator: '=', value: new Date() };
    },
    "isYesterday": function () {
        return { operator: '=', value: new Date(Date.now() - 86400000) };
    },
    "isTomorrow": function () {
        return { operator: '=', value: new Date(Date.now() + 86400000) };
    },
    "isNull": function ({ v, type }) {
        return { operator: 'IS NULL', value: v, type: type };
    },
    "isNotNull": function ({ v, type }) {
        return { operator: 'IS NOT NULL', value: v, type: type };
    }
}

compareLookups.isBlank = compareLookups.isEmpty;
compareLookups.isNotBlank = compareLookups.isNotEmpty;
compareLookups.equals = compareLookups['='];
compareLookups.notEquals = compareLookups['!='];
compareLookups.greaterThan = compareLookups['>'];
compareLookups.lessThan = compareLookups['<'];
compareLookups.greaterThanOrEqual = compareLookups['>='];
compareLookups.lessThanOrEqual = compareLookups['<='];
compareLookups.isBefore = compareLookups['<'];
compareLookups.isAfter = compareLookups['>'];
compareLookups.isOnOrBefore = compareLookups['<='];
compareLookups.isOnOrAfter = compareLookups['>='];

const extendClass = function (baseClass, config) {
    const newClass = class extends baseClass {
    }
    Object.assign(newClass.prototype, config);
    return newClass;
};

class BusinessBase {

    static businessObject = null;

    static compareLookups = compareLookups;

    static relationshipTypes = RelationshipTypes;
    
    logger = null;

    parseJson(json, defaultValue = null) {
        if (json === undefined || json === null) {
            return defaultValue;
        }
        if (typeof json === 'string') {
            return JSON.parse(json);
        }
        return json;
    }

    getTableName() {
        return this.tableName || this.constructor.name;
    }

    getSelectStatement(alias = 'Main') {
        const tableName = this.standardTable && this.useView !== false ? `vw${this.getTableName()}List` : this.getTableName();
        return this.selectStatement || `SELECT ${alias}.* FROM ${tableName} ${alias}`;
    }

    createRequest() {
        return BusinessBase.businessObject.sql.createRequest(this.logger);
    }

    createWhere({ alias = "Main", filterDeleted = true } = {}) {
        const where = {};
        if (this.clientBased && this.user.scopeId) {
            where[`${alias}.ClientId`] = this.user.scopeId;
        }
        if (filterDeleted && this.softDelete !== false) {
            where[`${alias}.IsDeleted`] = 0;
        }
        return where;
    }

    pluralize(str) {
        return str + 's';
    }

    async load({ id, relations }) {
        //added this to override clientBased in case of reports where client filtering is not required
        if(this.beforeLoad) {
            await this.beforeLoad({ id });
        }
        const { relations: definedRelations = [], keyField, multiSelectColumns = {} } = this;

        let query = this.getSelectStatement();

        const where = await this.createWhere({ filterDeleted: this.standardTable });
        where[keyField] = id;
        const request = this.createRequest();

        const sql = BusinessBase.businessObject.sql;

        query = sql.addParameters({ query, request, parameters: where, forWhere: true });

        query += ';';

        const childQueries = [];

        if (relations !== false) {
            for (const { relation: relationName, type: relationType, foreignTable, where: relationWhere, ...others } of definedRelations) {
                if (relationType === RelationshipTypes.OneToMany) {
                    childQueries.push({ relationName, ids: [] });
                    let { field } = others;
                    const { table: relationTable = relationName } = others;
                    if (!field) {
                        const boType = classMap.get(foreignTable);
                        field = boType.prototype.keyField;
                    }
                    query += `\r\nSELECT [${field}] AS ForeignId FROM [${relationTable}] WHERE [${keyField}] = @${keyField}`;
                    if (this.softDelete !== false) {
                        query += ` AND IsDeleted = 0`;
                    }
                    query += this.getRelationAdditionalQuery({ sql, request, relationWhere });
                    query += ';';
                }
            }
        }

        const result = await request.query(query);

        const data = result.recordset[0] || {};

        for (let i = 0; i < childQueries.length; i++) {
            const childQuery = childQueries[i];
            const childResult = result.recordsets[i + 1];
            const propName = this.pluralize(childQuery.relationName);
            data[propName] = childResult ? childResult.map(entry => entry.ForeignId).join(",") : "";
        }

        if (Object.keys(multiSelectColumns).length) {
            const multiSelectQueries = Object.entries(multiSelectColumns).map(([columnName, columnConfig]) => {
                // Validate column names to prevent SQL injection
                SqlHelper.validateAndSanitizeFieldName(columnName);
                
                const tableName = columnConfig.table || `${this.getTableName()}${columnName}`;
                const foreignKey = columnConfig.column || columnName;
                
                // Validate table and column names
                SqlHelper.validateAndSanitizeFieldName(foreignKey);
                
                let query = `SELECT '${columnName}' as columnName, ${foreignKey} FROM ${tableName} WHERE ${keyField}=${id}`;
                if (this.softDelete !== false) {
                    query += ' and IsDeleted = 0 ';
                }
                return query;
            });

            const combinedQuery = multiSelectQueries.join(';');
            const multiSelectResults = await sql.query(combinedQuery);

            if (!data.GroupName && this.groupNameKey) {
                data.GroupName = data[this.groupNameKey];
            }

            // Process each result set
            multiSelectResults.forEach((resultSet) => {
                const { columnName } = resultSet;
                const datakey = Object.keys(resultSet).find(key => key !== 'columnName');
                if (!data[columnName]) data[columnName] = [];
                if (!Array.isArray(data[columnName])) {
                    data[columnName] = data[columnName].split(",").map(v => v.trim());
                }
                const values = new Set([...data[columnName], resultSet[datakey]]);
                const noEmptyValues = [...values].filter(v => v);
                const isArrayFormat = multiSelectColumns[columnName].dataFormat === 'array'; // dataFormat specifies the format for multi-select
                data[columnName] = isArrayFormat ? noEmptyValues : noEmptyValues.join(', ');
            });
        }

        return data;
    }

    async save(options) {
        let { id, relations, relationsObject, ...values } = options;
        const methodParams = { id, relationsObject, relations, values };
        if (this.beforeSave) {
            await this.beforeSave(methodParams);
        }
        const { relations: definedRelations = [], isStandard = true, readOnlyColumns = [], user, clientBased, updateKeyField, multiSelectColumns = {} } = this;
        let { keyField } = this;
        if (updateKeyField) {
            keyField = updateKeyField;
        }
        const tableName = this.getTableName();
        const isUpdate = id ? parseInt(id) !== 0 : false;
        const sql = BusinessBase.businessObject.sql;
        const clientId = user.scopeId;

        // todo: Client check

        if (isStandard) {
            readOnlyColumns.push("IsDeleted", "CreatedByUserId", "CreatedByUser", "ModifiedByUserId", "ModifiedByUser", "CreatedOn", "ModifiedOn");
        }

        // todo: Delete with case-insensitivity
        for (const colName of readOnlyColumns) {
            delete values[colName];
        }

        const multiSelectValues = {};
        Object.keys(multiSelectColumns).forEach(colName => {
            if (![undefined, null].includes(values[colName])) {
                multiSelectValues[colName] = values[colName]
            }
            delete values[colName];
        });

        if (isUpdate) {
            values[keyField] = id;
        } else {
            delete values[keyField];
        }
        if (isStandard) {
            if (!isUpdate) {
                if (user.id) {
                    values.CreatedByUserId = user.id;
                }
                values.CreatedOn = new Date();
            }
            if (user.id) {
                values.ModifiedByUserId = user.id;
            }
            values.ModifiedOn = new Date();
        }

        if (clientBased && clientId) {
            if (isUpdate) {
                if (values.ClientId !== clientId) {
                    throw new Error("Security violation");
                }
                delete values.ClientId;
            } else {
                values.ClientId = clientId;
            }
        }

        const requestValues = { ...values };

        if (relations !== false) {
            for (const { relation: relationName, type: relationType } of definedRelations) {
                if (relationType === RelationshipTypes.OneToMany) {
                    const propertyName = this.pluralize(relationName);
                    delete requestValues[propertyName];
                }
            }
        }

        const result = await sql.insertUpdate({ tableName, keyField, id, json: requestValues, update: isUpdate, logger: this.logger });

        if (this.afterSave) {
            await this.afterSave(methodParams);
        }

        if (result.success) {
            if (!isUpdate) {
                id = result.data[0].Id;
            }

            try {
                if (Object.keys(multiSelectValues).length) {
                    await BusinessBase.handleMultiSelectValues({
                        multiSelectValues,
                        multiSelectColumns,
                        getTableName: this.getTableName.bind(this),
                        keyField,
                        id,
                        user,
                        sql,
                        isUpdate,
                        softDelete: this.softDelete
                    });
                }
            }
            catch (err) {
                if (!isUpdate && [enums.UniqueKeyErrorCode, enums.UniqueIndexErrorCode].includes(err.number)) { // for Unique Key voilation
                    // Deleting the referenced records
                    const deleteQueries = Object.keys(multiSelectValues).map(colName => {
                        const config = multiSelectColumns[colName] || {};
                        const tableName = config.table || `${this.getTableName()}${colName}`;
                        return `DELETE from ${tableName} WHERE ${keyField} = ${id}`;
                    });
                    if (deleteQueries.length) {
                        await sql.query(deleteQueries.join(';'));
                    }
                    // Deleting the parent record
                    await sql.query(`DELETE from  ${tableName} WHERE ${keyField} = ${id}`);
                }
                result.err = err;
                result.success = false;
            }

            if (relations !== false) {
                for (const { relation: relationName, type: relationType, foreignTable, where: relationWhere, ...others } of definedRelations) {
                    if (relationType === RelationshipTypes.OneToMany) {
                        const propertyName = this.pluralize(relationName);
                        const value = (values[propertyName] || "").trim();
                        const relatedValuesTemp = value.length ? value.split(",").map(v => parseInt(v)).filter(v => v !== 0 && v > 0 && !isNaN(v)) : [];
                        const relatedValues = [...new Set(relatedValuesTemp)];
                        delete values[propertyName];

                        let { field } = others;
                        const { table: relationTable = relationName } = others;
                        if (!field) {
                            const boType = classMap.get(foreignTable) || relationsObject[foreignTable];
                            field = boType.prototype.keyField;
                        }

                        const request = sql.createRequest();
                        let query = "";
                        sql.addParameters({ request, parameters: { KeyField: id, selected: relatedValues.join(','), UserId: user.id } })

                        const insertFields = [keyField, field];
                        const insertValues = ["@keyField AS KeyField", "value"];

                        const additionalQuery = this.getRelationAdditionalQuery({ sql, request, relationWhere, insertFields, insertValues });

                        if (this.softDelete !== false) {
                            query += `UPDATE [${relationTable}] SET [IsDeleted] = 1, ModifiedByUserId = @UserId, ModifiedOn = GETUTCDATE() WHERE IsDeleted = 0 AND [${keyField}] = @KeyField  ${additionalQuery}`
                            if (relatedValues.length > 0) {
                                query += ` AND ${field} NOT IN (SELECT [value] FROM string_split(@selected, ','));`;
                            }
                            if (relatedValues.length) {
                                query += `\r\nINSERT INTO [${relationTable}] (${insertFields.join(",")}, CreatedByUserId, ModifiedByUserId) SELECT ${insertValues.join(",")}, @UserId CreatedByUserId, @UserId ModifiedByUserId FROM string_split(@selected, ',') SelectedValues WHERE NOT EXISTS(SELECT 1 FROM [${relationTable}] WHERE [IsDeleted] = 0 AND  [${keyField}] = @KeyField AND ${field}=SelectedValues.value ${additionalQuery})`;
                            }
                        } else {
                            query += `UPDATE [${relationTable}] SET ModifiedByUserId = @UserId, ModifiedOn = GETUTCDATE() WHERE [${keyField}] = @KeyField  ${additionalQuery}`;
                            if (relatedValues.length > 0) {
                                query += ` AND ${field} NOT IN (SELECT [value] FROM string_split(@selected, ','));`;
                            }
                            if (relatedValues.length) {
                                query += `\r\nINSERT INTO [${relationTable}] (${insertFields.join(",")}, CreatedByUserId, ModifiedByUserId) SELECT ${insertValues.join(",")}, @UserId CreatedByUserId, @UserId ModifiedByUserId FROM string_split(@selected, ',') SelectedValues WHERE NOT EXISTS(SELECT 1 FROM [${relationTable}] WHERE [${keyField}] = @KeyField AND ${field}=SelectedValues.value ${additionalQuery})`;
                            }
                        }
                        // todo: handle if an error happens here
                        await request.query(query);
                    }
                }
            }
        }

        if (result.err) {
            let message = result.err.message || result.err;
            if (typeof message === 'string') {
                message = sqlErrorMapper.map(message);
            } else {
                message = "Unknown error";
            }
            result.err = message;
        }
        return result;
    }

    getRelationAdditionalQuery({ sql, request, relationWhere, insertFields = [], insertValues = [] }) {
        let additionalQuery = '';
        // todo: client Id query
        if (relationWhere) {
            const additionalParameters = {};
            const additionalParams = [];
            for (const key in relationWhere) {
                const paramName = `_rel_${key}_` + Object.keys(request.parameters).length;
                additionalParameters[paramName] = { fieldName: key, value: relationWhere[key] };
                additionalParams.push(`${key} = @${paramName}`);
                insertFields.push(key);
                insertValues.push('@' + paramName);
            }
            sql.addParameters({ request, parameters: additionalParameters });
            additionalQuery = additionalParams.join(' AND ');
        }
        additionalQuery = (additionalQuery.length > 0 ? ' AND ' : '') + additionalQuery;
        return additionalQuery;
    }

    async hardDelete({ id }) {
        const { keyField, childTables = [], relatedFields = [] } = this;
        const tableName = this.getTableName();
        const { sql } = BusinessBase.businessObject;
        for (const relatedField of relatedFields) {
            const result = await sql.query(`SELECT * FROM ${relatedField} WHERE ${keyField} = ${Number(id)} and IsDeleted=0;`);
            if (result.length) {
                throw new Error(`${tableName} is tied to ${result.length} number of ${relatedField}`);
            }
        }
        for (const childTable of childTables) {
            const foreignKey = childTable.foreignKey || keyField;
            await sql.query(`DELETE from ${childTable.tableName} WHERE ${foreignKey} = ${id}`);
        }
        return await sql.query(`DELETE from ${tableName} WHERE ${keyField} = ${id}`);
    }

    async delete({ id, values = {} }) {
        // Invoke optional beforeDelete hook for custom validation or pre-deletion logic.
        if (this.beforeDelete) {
            await this.beforeDelete({ id });
        }
        if (this.softDelete === false) {
            return await this.hardDelete({ id });
        }
        const { keyField, relatedFields = [], childTables = [] } = this;
        const tableName = this.getTableName();
        if (!(keyField in values)) {
            values[keyField] = id;
        }
        values[IsDeletedColumn] = 1;
        const { sql } = BusinessBase.businessObject;
        for (const relatedField of relatedFields) {
            const result = await sql.query(`SELECT * FROM ${relatedField} WHERE ${keyField} = ${Number(id)} and IsDeleted = 0`);
            if (result.length) {
                throw new Error(`${tableName} is tied to ${result.length} number of ${relatedField}`);
            }
        }
        for (const childTable of childTables) {
            const foreignKey = childTable.foreignKey || keyField;
            const childTableKeyField = childTable.keyField || `${childTable.tableName}Id`;
            let updateStatement = 'IsDeleted = 1 ';
            if (childTable.useDeleteKey) {
                updateStatement += `, DeleteKey = ${childTable.tableName}.${childTableKeyField} `;
            }
            await sql.query(`UPDATE ${childTable.tableName} SET ${updateStatement} WHERE ${foreignKey} = ${id}`);
        }
        return await sql.insertUpdate({ tableName: this.getTableName(), keyField, id, json: values, update: true, logger: this.logger });
    }

    getListStatement() {
        return this.listStatement || (this.standardTable && this.useView !== false ? `SELECT * FROM vw${this.getTableName()}List Main` : this.getSelectStatement());
    }

    async lookupList({ scopeId }) {
        const request = this.createRequest();
        const { keyField, lookupSortOrder, defaultSortOrder, displayField, clientBased, lookupListStatement = '', tableName } = this;
        const sort = lookupSortOrder || defaultSortOrder;
        if (lookupListStatement) {
            const result = await request.query(lookupListStatement);
            return result.recordset;
        }
        const sql = BusinessBase.businessObject.sql;

        let listStatement = this.getListStatement();
        const isStandard = this.standardTable === true && listStatement.indexOf("vw") === -1;
        const labelField = displayField || sort || this.sort;
        if (!labelField) {
            this.logger.error('No displayField or sort field defined for lookupList label.');
        }

        listStatement = listStatement.replace(/^.+ FROM/i, `SELECT [${keyField}] value, [${labelField}] label FROM `);

        let query = listStatement;
        const where = await this.createWhere({ filterDeleted: isStandard, tableName });
        if (!clientBased && scopeId) {
            where.ScopeId = scopeId;
        }

        query = sql.addParameters({ query, request, parameters: where, forWhere: true });

        if (sort) {
            query += ` ORDER BY ${sort}`;
        }

        const result = await request.query(query);

        return result.recordset;
    }

    async list({ start = 0, limit = 100, sort, filter, groupBy, include, exclude, returnCount = true }) {
        sort = sort || this.defaultSortOrder;
        const request = this.createRequest();
        const { keyField } = this;
        const sql = BusinessBase.businessObject.sql;
        const whereArr = this.parseJson(filter, []);
        let totalStatement = "SELECT COUNT(1) AS TotalCount";

        const { relations = [] } = this;
        let listStatement = this.getListStatement();
        const isStandard = this.standardTable === true && listStatement.indexOf("vw") === -1;
        const isDataFromView = listStatement.indexOf("vw") > -1;
        const additionalColumns = [];
        if (isStandard) {
            listStatement += '\r\n LEFT OUTER JOIN (SELECT UserId Created_UserId, UserName as CreatedByUser FROM Security_User) Created_ ON Created_.Created_UserId = Main.CreatedByUserId'
            listStatement += '\r\n LEFT OUTER JOIN (SELECT UserId Modified_UserId, UserName as ModifiedByUser From Security_User) Modified_ ON Modified_.Modified_UserId = Main.ModifiedByUserId'
            additionalColumns.push('Created_.CreatedByUser', 'Modified_.ModifiedByUser');
        }
        for (const relation of relations) {
            const relationName = relation.relation;
            const deleteStatement = this.softDelete !== false ? "WHERE IsDeleted = 0" : "";
            if (relation.countInList && relation.type === RelationshipTypes.OneToMany) {
                const additionalQuery = this.getRelationAdditionalQuery({ sql, request, relationWhere: relation.where });
                const relationTableName = relation.table || relationName;
                listStatement += `\r\n LEFT OUTER JOIN (SELECT ${keyField} ${relationName}_${keyField}, COUNT(1) as ${relationName}Count FROM [${relationTableName}] ${deleteStatement}  ${additionalQuery} GROUP BY ${keyField}) [${relationName}] ON [${relationName}].${relationName}_${keyField} = Main.${keyField}`;
                additionalColumns.push(`[${relationName}].${relationName}Count ${relationName}Count`);
            }
            if (relation.type === RelationshipTypes.OneToOne && relation.listColumns) {
                const join = [];
                for (const joinCondition of relation.join) {
                    join.push(`${relationName}.${joinCondition} = Main.${relation.join[joinCondition]}`)
                }
                listStatement += ` LEFT OUTER JOIN (SELECT ${relation.listColumns} FROM ${relationName} ${deleteStatement}) ${relationName} ON ${join.join(' AND ')}`
                additionalColumns.push(`${relationName}.${relationName}Count ${relationName}Count`);

            }
        }
        if (additionalColumns.length > 0) {
            listStatement = listStatement.replace(/ from /i, ', ' + additionalColumns.join(', ') + ' FROM ');
        }

        let query = listStatement;
        const where = this.createWhere({ filterDeleted: isStandard });
        if (typeof include === 'string') {
            include = include.split(',').map(item => Number(item));
        }
        if (typeof exclude === 'string') {
            exclude = exclude.split(',').map(item => Number(item));
        }
        if (Array.isArray(include)) {
            where["_include"] = { fieldName: keyField, operator: "in", value: include };
        }
        if (Array.isArray(exclude)) {
            where["_exclude"] = { fieldName: keyField, operator: "not in", value: exclude };
        }
        if (this.useIsActive && (Array.isArray(include) || Array.isArray(exclude))) {
            where["_isActive"] = { fieldName: "IsActive", operator: "=", value: true };
        }
        if (whereArr.length) {
            whereArr.forEach((ele) => {
                const { operator, field, value, type } = ele;
                const filterValue = compareLookups[operator]({ v: value, field, type });
                let fieldName = isDataFromView ? field : `Main.${field}`;
                if (filterFields[field]) {
                    fieldName = `${filterFields[field]}.${field}`;
                }
                if (typeof (filterValue) === 'string') {
                    where[fieldName] = { statement: filterValue.replaceAll('${field}', fieldName) }
                } else if (filterValue) {
                    where[fieldName] = { operator: filterValue.operator, value: filterValue.value, sqlType: filterValue.sqlType };
                }
            })
        }
        query = sql.addParameters({ query, request, parameters: where, forWhere: true });

        start = Number(start);
        limit = Number(limit);

        const needToGetCount = returnCount && limit > 0;


        if (needToGetCount) {
            const match = / from /i.exec(query);
            totalStatement += query.substring(match.index);
        }

        if (sort) {
            let orderByFields = sort.split(',');
            orderByFields = orderByFields.map(field => SqlHelper.sanitizeField(field));
            query += ' ORDER BY ' + SqlHelper.sanitizeField(orderByFields.join(', '));
        }

        if (limit > 0) {
            query += ' OFFSET @_start ROWS FETCH NEXT @_limit ROWS ONLY';
            query = BusinessBase.businessObject.sql.addParameters({ query: query, request, parameters: { _start: start, _limit: limit }, forWhere: false });
        }

        if (groupBy) {
            let groupByFields = groupBy.split(',');
            groupByFields = groupByFields.map(field => SqlHelper.sanitizeField(field));
            const groupByStatement = ' GROUP BY ' + SqlHelper.sanitizeField(groupByFields.join(', '));
            query += groupByStatement;
            totalStatement += groupByStatement;
        }

        query += ';';

        if (needToGetCount) {
            query += totalStatement;
        }


        const result = await request.query(query);

        if (returnCount) {
            let recordCount;

            if (limit > 0) {
                recordCount = result.recordsets[1][0].TotalCount;
            } else {
                recordCount = result.rowsAffected[0];
            }

            return {
                records: result.recordset,
                recordCount
            }
        } else {
            return {
                records: result.recordset
            }
        }

    }

    static async handleMultiSelectValues({ multiSelectValues, multiSelectColumns, getTableName, keyField, id, user, sql, isUpdate, softDelete }) {
        for (const [colName, colValue] of Object.entries(multiSelectValues)) {
            const config = multiSelectColumns[colName] || {};
            const dataFormat = config.dataFormat || "string"; // string or array
            const tableName = config.table || `${getTableName()}${colName}`;
            const foreignKey = config.column || colName;
            const typeOfForeignKey = config.type || "string";
            const useDeleteKey = config.useDeleteKey || false;
            const childRecordKeyField = config.keyField || `${tableName}Id`;
            const isNumber = typeOfForeignKey === "number";
            let newEntries = dataFormat === "array" ? colValue : colValue.split(",").map(v => v.trim());
            const primaryKey = `${tableName}Id`;
            let projection = foreignKey;
            if (foreignKey !== primaryKey) {
                projection += `, ${primaryKey}`;
            }
            let query = `SELECT ${projection} FROM ${tableName} where ${keyField}=${id}`;
            if (softDelete !== false) {
                query += ' and IsDeleted = 0';
            }
            const dataRes = await sql.query(query);
            const foreignKeyMap = dataRes.reduce((acc, item) => {
                acc[item[foreignKey]] = item[primaryKey];
                return acc;
            }, {});
            let existingEntries = Array.from(dataRes).map(entry => entry[foreignKey]);
            if (isNumber) {
                newEntries = newEntries.map(v => parseInt(v)).filter(v => v !== 0 && v > 0 && !isNaN(v));
                existingEntries = existingEntries.map(entry => parseInt(entry));
            } else {
                newEntries = newEntries.map(entry => entry.trim()).filter(entry => entry !== "");
            }
            const removedEntries = existingEntries.filter(entry => !newEntries.includes(entry));
            const newlyAddedEntries = newEntries.filter(entry => !existingEntries.includes(entry));
            if (removedEntries.length && isUpdate) {
                const primaryKeys = removedEntries.map((item) => foreignKeyMap[item]).join(',');
                if (softDelete !== false) {
                    let updateStatement = 'IsDeleted = 1';
                    if (useDeleteKey) {
                        updateStatement += `, DeleteKey = ${tableName}.${childRecordKeyField} `;
                    }
                    await sql.query(`UPDATE ${tableName} SET ${updateStatement} WHERE ${primaryKey} IN (${primaryKeys})`);
                } else {
                    await sql.query(`Delete from ${tableName} WHERE ${primaryKey} IN (${primaryKeys})`);
                }
            }
            if (newlyAddedEntries.length) {
                const insertParams = newlyAddedEntries.map(entry => {
                    if (isNumber) {
                        return `(${entry}, ${id}, ${user.id}, ${user.id})`;
                    } else {
                        return `('${entry}', ${id}, ${user.id}, ${user.id})`;
                    }
                }).join(",");
                await sql.query(`INSERT INTO ${tableName} (${foreignKey}, ${keyField}, ModifiedByUserId, CreatedByUserId) VALUES ${insertParams}`);
            }
        }
    }
}

const classMap = {
    map: new Map(),
    baseTypes: {
        "default": BusinessBase
    },
    register: function (name, configOrClass) {
        const { baseTypes } = this;
        if (configOrClass.prototype instanceof BusinessBase) {
            this.map.set(name.toUpperCase(), configOrClass);
        } else {
            const { baseType = "default" } = configOrClass;
            const DerivedType = extendClass(baseTypes[baseType], { standardTable: true, clientBased: true, softDelete: true, tableName: name, keyField: `${name}Id`, ...configOrClass });
            this.map.set(name.toUpperCase(), DerivedType);
        }
    },
    get: function (name) {
        return this.map.get(name.toUpperCase());
    }
};

export { RelationshipTypes, BusinessBase, classMap };

export default BusinessBase;