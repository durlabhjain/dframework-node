import mssql from 'mssql';
import SqlHelper from './sql-helper.mjs';
import { sqlErrorMapper } from './error-mapper.mjs';
import { getDecimalSqlType } from '../sql-type-inference.js';
import ConcatenatedColumns from './concatenated-columns.mjs';
import { applyServerRowGrouping } from './row-grouping.mjs';

const enums = {
    startDateTime: '00:00:00',
    endDateTime: '23:59:59.997',
    UniqueKeyErrorCode: 2627,
    UniqueIndexErrorCode: 2601
}

function appendTime({ date, start = true }) {
    if (date.indexOf(' ') === -1) {
        return `${date} ${start ? enums.startDateTime : enums.endDateTime}`;
    }
    if (!start && date.indexOf('.') === -1) {
        return `${date}.997`;
    }
    return date;
}

const RelationshipTypes = {
    OneToMany: "OneToMany",
    OneToOne: "OneToOne"
}

const filterFields = {
    CreatedByUser: "Created_",
    ModifiedByUser: "Modified_"
}

const OperationMode = {
    load: 'load',
    list: 'list',
    lookupList: 'lookupList',
};

const dateTypeFields = ["date", "dateTime"];

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
        return { operator: 'IS', value: null, type: type };
    },
    "isNotEmpty": function ({ type }) {
        return { operator: 'IS NOT', value: null, type: type };
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
            const values = typeof v === 'object' ? v : [appendTime({ date: v, start: true }), appendTime({ date: v, start: false })];
            toReturn = { operator: 'BETWEEN', value: values, sqlType: mssql.VarChar, type: type };
        } else {
            toReturn = { operator: '=', value: v, type: type };
        }
        return toReturn;
    },
    "not": function ({ v, type }) {
        if (dateTypeFields.includes(type)) {
            const values = [appendTime({ date: v, start: true }), appendTime({ date: v, start: false })];
            return { operator: 'NOT BETWEEN', value: values, sqlType: mssql.VarChar, type: type };
        } else {
            return { operator: '!=', value: v, type: type };
        }
    },
    "onOrAfter": function ({ v, type }) {
        return { operator: '>=', value: appendTime({ date: v, start: true }), type: type };
    },
    "onOrBefore": function ({ v, type }) {
        return { operator: '<=', value: appendTime({ date: v, start: false }), type: type };
    },
    "after": function ({ v, type }) {
        return { operator: '>', value: appendTime({ date: v, start: false }), type: type };
    },
    "before": function ({ v, type }) {
        return { operator: '<', value: appendTime({ date: v, start: true }), type: type };
    },
    "isAnyOf": function ({ v, type }) {
        let sqlType = mssql.VarChar;

        if (Array.isArray(v) && v.length && v.every(n => typeof n === 'number' && Number.isFinite(n))) {
            sqlType = v.every(Number.isSafeInteger) ? mssql.Int : getDecimalSqlType(v);
        }

        return { operator: 'IN', value: v, sqlType, type };
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
compareLookups.doesNotContain = compareLookups.notContains;

const extendClass = function (baseClass, defaultProperties, config) {
    const ExtendedClass = class extends baseClass {
        constructor(...args) {
            super(...args);
            if (defaultProperties && typeof defaultProperties === 'object') {
                for (const key in defaultProperties) {
                    if (!this.hasOwnProperty(key)) {
                        this[key] = defaultProperties[key];
                    }
                }
            }
            Object.assign(this, config);
        }
    }
    ExtendedClass.prototype.initialConfig = config;
    return ExtendedClass;
};

class BusinessBase {

    static businessObject = null;

    static compareLookups = compareLookups;

    static relationshipTypes = RelationshipTypes;

    logger = null;

    // tableName - automatically derived from class name

    // keyField - automatically derived from class name

    standardTable = true;

    clientBased = true;

    softDelete = true;

    /**
     * useColumnField - Set when the list statement already exposes filterable columns under their
     * final names (a view, or a hand-written projection), so list filters are not prefixed with `Main.`.
     */
    useColumnField = false;

    /**
     * useAliasName - Set when every filterable column must be qualified with `Main.` regardless of
     * where the statement sources its rows. Takes precedence over useColumnField.
     */
    useAliasName = false;

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

    dbAdapter = 'sql';

    getDatabaseAdapter() {
        return BusinessBase.businessObject[this.dbAdapter];
    }

    /**
     * Generates a WHERE clause object based on the current business object's configuration and optional parameters.
     * @param {Object} [options]
     * @param {string} [options.alias="Main"] - The alias to use for table references in the WHERE clause.
     * @param {boolean} [options.isStandard] - When true, apply soft-delete filtering (IsDeleted = 0) if enabled.
     * @returns {Promise<Object>} A WHERE clause object that can be passed to sql.addParameters({ forWhere: true }).
     */
    async createWhere({ alias = "Main", ...options } = {}) {
        const where = {};
        if (this.clientBased && this.user.scopeId) {
            where[`${alias}.ClientId`] = this.user.scopeId;
        }
        if (options.isStandard && this.softDelete !== false) {
            where[`${alias}.IsDeleted`] = 0;
        }
        if (typeof this.customizeWhere === 'function') {
            await this.customizeWhere({ where, alias, ...options });
        }
        return where;
    }

    /**
     * customizeWhere - Optional hook for customizing the WHERE clause in SQL queries.
     * @param {Object} param0 - An object containing the current WHERE clause, alias, and additional options.
     * @returns {Promise<void>} A promise that resolves when the customization is complete.
     */

    pluralize(str) {
        return str + 's';
    }

    async load({ id, relations }) {
        //added this to override clientBased in case of reports where client filtering is not required
        if (this.beforeLoad) {
            await this.beforeLoad({ id });
        }
        const { relations: definedRelations = [], keyField, multiSelectColumns = {} } = this;

        let query = this.getSelectStatement();

        const where = await this.createWhere({ isStandard: this.standardTable, operationMode: OperationMode.load });
        where[keyField] = id;
        const sql = this.getDatabaseAdapter();
        const request = sql.createRequest();

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
                        if (!boType) {
                            throw new Error(`Business Object for relation ${relationName} not found`);
                        }
                        field = new boType().keyField;
                    }
                    query += `\r\nSELECT ${field} AS ForeignId FROM ${relationTable} WHERE ${keyField} = ${sql.buildParameterName(keyField)}`;
                    if (this.softDelete !== false) {
                        query += ` AND IsDeleted = 0`;
                    }
                    query += this.getRelationAdditionalQuery({ sql, request, relationWhere });
                    query += ';';
                }
            }
        }

        const result = await sql.runQuery({ request, type: "query", query });
        if (result.err) throw result.err;

        const data = result.recordsets[0][0] || {};

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
        const sql = this.getDatabaseAdapter();
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
                            if (!boType) {
                                throw new Error(`Business Object for relation ${relationName} not found`);
                            }
                            field = new boType().keyField;
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
                const paramName = `_rel_${key}_` + Object.keys(request.parameters || request.params).length;
                additionalParameters[paramName] = { fieldName: key, value: relationWhere[key] };
                additionalParams.push(`${key} = ${sql.buildParameterName(paramName)}`);
                insertFields.push(key);
                insertValues.push(sql.buildParameterName(paramName));
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

    /**
     * queryFileName - Optional property to specify a SQL file for the list statement. If provided, this file will be used instead of the default listStatement or generated SELECT statement.
     */
    queryFileName = null;

    async getListStatement(listParameters) {
        let listStatement;
        if (this.queryFileName) {
            listStatement = await listParameters.sql.getQuery(this.queryFileName);
        } else {
            listStatement = this.listStatement || (this.standardTable && this.useView !== false ? `SELECT * FROM vw${this.getTableName()}List Main` : this.getSelectStatement());
        }
        const isStandard = this.standardTable === true && listStatement.indexOf("vw") === -1;
        return { listStatement, isStandard };
    }

    normalizeListStatement(result) {
        if (typeof result === 'string') {
            return {
                listStatement: result,
                isStandard: this.standardTable === true && result.indexOf("vw") === -1
            }
        }
        return result;
    }

    async lookupList({ scopeId }) {
        const sql = this.getDatabaseAdapter();
        const request = sql.createRequest();
        const { keyField, lookupSortOrder, defaultSortOrder, displayField, clientBased, lookupListStatement = '', tableName } = this;
        const sort = lookupSortOrder || defaultSortOrder;
        if (lookupListStatement) {
            const result = await sql.runQuery({ request, type: "query", query: lookupListStatement });
            if (result.err) throw result.err;
            return result.recordsets[0];
        }

        let { listStatement, isStandard } = this.normalizeListStatement(
            await this.getListStatement({
                sql,
                scopeId,
                operationMode: OperationMode.lookupList,
                keyField,
                lookupSortOrder,
                defaultSortOrder,
                displayField,
                clientBased,
                lookupListStatement,
                tableName,
                sort
            })
        );
        const labelField = displayField || sort || this.sort;
        if (!labelField) {
            this.logger.error('No displayField or sort field defined for lookupList label.');
        }

        listStatement = listStatement.replace(/^.+ FROM/i, `SELECT [${keyField}] value, [${labelField}] label FROM `);

        let query = listStatement;
        const where = await this.createWhere({ isStandard, tableName, operationMode: OperationMode.lookupList });
        if (!clientBased && scopeId) {
            where.ScopeId = scopeId;
        }

        query = sql.addParameters({ query, request, parameters: where, forWhere: true });

        if (sort) {
            query += ` ORDER BY ${sort}`;
        }

        const result = await sql.runQuery({ request, type: "query", query });

        return result.recordsets[0];
    }

    /**
     * addAdditionalColumns - Optional hook for adding custom JOINs and columns to the list SQL statement.
     * @param {Object} param0 - An object containing the current SQL statement, request, and additional parameters for context.
     * @returns {Promise<Object>} An object that can include a modified listStatement and an array of additionalColumns to be added to the SELECT clause.
     */

    /**
     * customizeList - Optional hook for customizing the list results
     * @param {Object} param0 - An object containing the current SQL statement, request, and additional parameters for context.
     * @returns {Promise<void>} A promise that resolves when the customization is complete.
     */

    /**
     * Builds the ORDER BY clause for a list query.
     *
     * Kept as its own method so subclasses can extend sorting without forking `list()` - the
     * shadow-column substitution and case-insensitive wrapping below are easy to lose in a fork.
     *
     * @param {string} sort - Comma-separated sort fields, each optionally followed by ASC/DESC.
     * @returns {string} The ORDER BY clause (with a leading space), or an empty string when `sort` is falsy.
     */
    buildSortClause(sort) {
        if (!sort) {
            return '';
        }
        const sql = this.getDatabaseAdapter();
        const orderByFields = sort.split(',').map(field => {
            const parts = field.trim().split(/\s+/);
            const shadowFieldName = sql.applyShadowColumns(parts[0]);
            const fieldName = SqlHelper.sanitizeField(shadowFieldName);
            const isShadowColumn = shadowFieldName !== parts[0];
            const direction = parts[1] && ['ASC', 'DESC'].includes(parts[1].toUpperCase()) ? parts[1].toUpperCase() : '';
            const wrappedField = isShadowColumn ? fieldName : sql.applyOrderByCaseInsensitive(fieldName);
            return direction ? `${wrappedField} ${direction}` : wrappedField;
        });
        return ' ORDER BY ' + orderByFields.join(', ');
    }

    /**
     * Translates the parsed user filter array into a where-fragment object suitable for
     * `sql.addParameters({ forWhere: true })`.
     *
     * Returned separately from the system where (soft delete, client scoping, include/exclude) so
     * the two can be applied in separate passes - user filters may be OR-joined, system conditions
     * never are. Overridable so consumers can add their own filter dialect without forking `list()`.
     *
     * @param {Array<Object>} whereArr - Parsed filter entries: `{ field, operator, value, type, sqlType }`.
     * @param {Object} context - The list hook parameters (`sql`, `request`, `isDataFromView`, `isStandard`, `concatenatedColumns`).
     * @returns {Object} A where-fragment object; empty when there is nothing to filter on.
     */
    buildFilterWhere(whereArr, { sql, request, isDataFromView, isStandard, concatenatedColumns = [] } = {}) {
        const where = {};
        if (!whereArr?.length) {
            return where;
        }
        const { useAliasName, useTvp, inOperatorStrategy } = this;
        whereArr.forEach((ele, index) => {
            if (!ele) return;   // guard against null/ undefined
            const { operator, field, value, type, sqlType = null } = ele;
            if (!field) return; // guard against filter objects with missing field name
            const filterValue = compareLookups[operator]({ v: value, field, type });
            const concatIdx = concatenatedColumns?.findIndex(c => c.DisplayColumn === field) ?? -1;
            if (concatIdx !== -1) {
                const concatenatedColumn = concatenatedColumns[concatIdx];
                const paramName = `concat_${index}`;
                if (typeof filterValue === 'string') {
                    where[`filter_${index}`] = {
                        statement: ConcatenatedColumns.applyStringFilter({
                            sql,
                            value,
                            concatenatedColumn,
                            request,
                            paramName,
                            operator: sql.normalizeOperator(operator)
                        })
                    };
                } else if (filterValue) {
                    where[`filter_${index}`] = {
                        statement: ConcatenatedColumns.applyStringFilter({
                            sql,
                            value: filterValue.value,
                            concatenatedColumn,
                            request,
                            paramName,
                            operator: sql.normalizeOperator(filterValue.operator)
                        })
                    };
                }
                return;
            }

            let fieldName = isDataFromView ? field : `Main.${field}`;
            // The Created_/Modified_ aliases only exist on the standard-table JOINs added by list().
            if (filterFields[field] && isStandard) {
                fieldName = `${filterFields[field]}.${field}`;
            }
            if (useAliasName === true) {
                fieldName = `Main.${field}`;
            }

            // Keyed per filter index rather than per field, so two filters on one column
            // (e.g. contains + notContains) don't overwrite each other.
            if (typeof filterValue === 'string') {
                where[`filter_${index}`] = { statement: filterValue.replaceAll('${field}', fieldName) };
                return;
            }
            if (!filterValue) {
                return;
            }
            const isEmptyStatement = sql.buildIsEmptyStatement({ fieldName, operator: filterValue.operator, type: filterValue.type });
            if (isEmptyStatement) {
                where[`filter_${index}`] = isEmptyStatement;
                return;
            }
            where[`filter_${index}`] = {
                ...filterValue,
                operator: sql.normalizeOperator(filterValue.operator),
                fieldName,
                sqlType: sqlType ?? filterValue.sqlType,
                useTvp,
                inOperatorStrategy
            };
        });
        return where;
    }

    /**
     * Pulls named entries out of a parsed filter array and blanks them, so a getListStatement hook
     * can consume filters it renders itself (date ranges, for instance) without them being emitted
     * a second time into the WHERE clause.
     *
     * @param {Array<Object>} filter - The parsed filter array; matched entries are set to null in place.
     * @param {...(string|{field: string, operator?: string, key?: string})} definitions - Filters to extract.
     * @returns {Object} The extracted values, keyed by `key` (defaulting to `field`).
     */
    extractAndRemoveFilters(filter, ...definitions) {
        const extracted = {};
        if (!Array.isArray(filter) || !definitions.length) {
            return extracted;
        }

        definitions.forEach((definition) => {
            const descriptor = typeof definition === 'string'
                ? { field: definition, key: definition }
                : definition;

            const { field, operator, key = field } = descriptor;
            if (!field) {
                return;
            }

            const index = filter.findIndex((ele) => ele && ele.field === field && (!operator || ele.operator === operator));
            extracted[key] = index > -1 ? filter[index]?.value : undefined;

            if (index > -1) {
                filter[index] = null;
            }
        });

        return extracted;
    }

    /**
     * Splits a SQL query into the part before its last top-level SELECT and the part from its last
     * FROM onwards, so a different projection can be spliced in while keeping any leading CTEs.
     *
     * @param {Object} params
     * @param {string} params.query - The SQL query to split.
     * @returns {[string, string]} `[beforeSelect, fromOnwards]`, or `[query, '']` when no split point is found.
     */
    splitQueryBasedOnFrom({ query }) {
        const fromMatch = [...query.matchAll(/ from /gi)].pop();
        if (!fromMatch || typeof fromMatch.index !== 'number') {
            return [query, ''];
        }
        const fromIndex = fromMatch.index;
        const beforeFrom = query.slice(0, fromIndex);
        const selectMatch = [...beforeFrom.matchAll(/select/gi)].pop();
        if (!selectMatch || typeof selectMatch.index !== 'number') {
            return [query, ''];
        }
        const selectIndex = selectMatch.index;
        return [
            query.slice(0, selectIndex),
            ` FROM ${query.slice(fromIndex + ' from '.length)}`
        ];
    }

    /**
     * Builds the companion COUNT query for a list query.
     *
     * A plain `FROM`-onwards splice breaks when the query opens with a CTE - the count projection
     * has to land after the WITH block, not in front of it - so CTE queries are split on their last
     * top-level SELECT/FROM pair instead.
     *
     * @param {Object} params
     * @param {string} params.query - The fully filtered list query, before ORDER BY/paging.
     * @param {string} [params.totalStatement] - The count projection to splice in.
     * @returns {string} The COUNT query.
     */
    buildTotalStatement({ query, totalStatement = "SELECT COUNT(1) AS TotalCount" }) {
        if (/^\s*with/i.test(query)) {
            const [beforeSelect, afterFrom] = this.splitQueryBasedOnFrom({ query });
            return beforeSelect + totalStatement + afterFrom;
        }
        const match = / from /i.exec(query);
        return totalStatement + query.substring(match.index);
    }

    /**
     * List records with optional hooks for extensibility
     * Supports hooks: beforeList, customizeWhere, addAdditionalColumns, buildFilterWhere,
     * customizeQuery, customizeList, afterList
     */
    async list({ start = 0, limit = 100, sort, filter, groupBy, rowGroupField, rowGroupAggregations, include, exclude, returnCount = true, logicalOperator = 'AND', ...options }) {
        sort = sort || this.defaultSortOrder;
        const sql = this.getDatabaseAdapter();
        const request = sql.createRequest(this.logger);
        const { keyField, concatenatedColumns = [] } = this;
        let totalStatement = "SELECT COUNT(1) AS TotalCount";

        let { relations = [] } = this;

        const hookParameters = {
            ...options,
            sql,
            request,
            keyField,
            start,
            limit,
            sort,
            // Parsed up front so hooks can read and splice out the filter entries they consume from
            // the same array that later builds the WHERE clause.
            filter: this.parseJson(filter, []),
            groupBy,
            include,
            exclude,
            returnCount,
            logicalOperator,
            relations,
            concatenatedColumns,
            // Collects non-WHERE bind parameters stashed by hooks; bound just before the query runs.
            parameters: {},
            operationMode: OperationMode.list
        };

        // Hook: beforeList - Allow normalizing/overriding list parameters before anything is built
        if (typeof this.beforeList === 'function') {
            await this.beforeList(hookParameters);
        }
        ({ start, limit, sort, groupBy, include, exclude, returnCount, logicalOperator, relations = [] } = hookParameters);
        const whereArr = hookParameters.filter || [];

        let { listStatement, isStandard } = this.normalizeListStatement(await this.getListStatement(hookParameters));
        const isDataFromView = listStatement.indexOf("vw") > -1 || this.useColumnField;

        hookParameters.listStatement = listStatement;
        hookParameters.isStandard = isStandard;
        hookParameters.isDataFromView = isDataFromView;

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

        // Hook: addAdditionalColumns - Allow adding custom JOINs and columns
        if (typeof this.addAdditionalColumns === 'function') {
            hookParameters.listStatement = listStatement;
            const result = await this.addAdditionalColumns(hookParameters);

            if (result) {
                listStatement = result.listStatement || listStatement;
                if (result.additionalColumns && result.additionalColumns.length > 0) {
                    additionalColumns.push(...result.additionalColumns);
                }
            }
        }

        if (additionalColumns.length > 0) {
            listStatement = listStatement.replace(/ from /i, ', ' + additionalColumns.join(', ') + ' FROM ');
        }

        hookParameters.listStatement = listStatement;
        const where = await this.createWhere(hookParameters);
        let query = hookParameters.listStatement;

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
        // Pass 1: system conditions (soft delete, client scoping, include/exclude) - always AND-joined,
        // so a user filter group can never weaken them.
        query = sql.addParameters({ query, request, parameters: where, forWhere: true });

        // Pass 2: user filters - joined with logicalOperator, and OR groups get parenthesized.
        const userWhere = this.buildFilterWhere(whereArr, hookParameters);
        if (Object.keys(userWhere).length) {
            const appendAnd = sql.findOutermostToken(query, /\bWHERE\b/i) !== -1;
            query = sql.addParameters({ query, request, parameters: userWhere, forWhere: true, logicalOperator, appendAnd });
        }

        // Hook: customizeQuery - Allow appending extra conditions once the WHERE clause is complete
        if (typeof this.customizeQuery === 'function') {
            hookParameters.query = query;
            hookParameters.where = where;
            const customizedQuery = await this.customizeQuery(hookParameters);
            query = typeof customizedQuery === 'string' ? customizedQuery : hookParameters.query;
        }

        // Snapshot before GROUP BY/ORDER BY/paging are appended below, so row grouping can
        // reuse the exact same filtered/scoped rows as the leaf query itself (see row-grouping.mjs).
        const filteredQuery = query;

        start = Number(start);
        limit = Number(limit);

        const needToGetCount = returnCount && limit > 0;

        if (needToGetCount) {
            totalStatement = this.buildTotalStatement({ query, totalStatement });
        }

        // GROUP BY has to precede ORDER BY and paging for the statement to be valid SQL.
        if (groupBy) {
            let groupByFields = Array.isArray(groupBy) ? groupBy : groupBy.split(',');
            groupByFields = groupByFields.map(field => SqlHelper.sanitizeField(field));
            const groupByStatement = ' GROUP BY ' + groupByFields.join(', ');
            query += groupByStatement;
            totalStatement += groupByStatement;
        }

        if (sort) {
            query += this.buildSortClause(sort);
        }

        if (limit > 0) {
            query = sql.addPaging({ query, request, start, limit });
        }

        query += ';';

        if (needToGetCount) {
            query += totalStatement;
        }

        if (Object.keys(hookParameters.parameters).length) {
            query = sql.addParameters({ query, request, parameters: hookParameters.parameters, forWhere: false });
        }

        const result = await sql.runQuery({ request, type: "query", query });
        if (result.err) throw result.err;

        const listResult = {
            records: result.recordsets[0]
        };

        if (listResult.records?.length && concatenatedColumns.length) {
            const resultValue = await ConcatenatedColumns.addColumns({ records: listResult.records, sql, columns: concatenatedColumns });
            if (resultValue !== null && resultValue !== undefined) {
                listResult.records = resultValue;
            }
        }


        if (returnCount) {
            if (limit > 0) {
                listResult.recordCount = result.recordsets[1][0].TotalCount;
            } else {
                listResult.recordCount = listResult.records?.length || 0;
            }
        }

        hookParameters.listResult = listResult;

        // Hook: customizeList - Allow result post-processing. Hooks may mutate
        // hookParameters.listResult, or return replacement records (array) / extra result keys (object).
        if (typeof this.customizeList === 'function') {
            const customResult = await this.customizeList(hookParameters);
            if (Array.isArray(customResult)) {
                hookParameters.listResult.records = customResult;
            } else if (customResult && typeof customResult === 'object') {
                Object.assign(hookParameters.listResult, customResult);
            }
        }

        if (rowGroupField) {
            hookParameters.listResult.records = await applyServerRowGrouping({
                sql, request, query: filteredQuery, records: hookParameters.listResult.records,
                rowGroupField, rowGroupAggregations, logger: this.logger
            });
        }

        // Hook: afterList - Allow decorating the final result (extra columns, derived totals)
        if (typeof this.afterList === 'function') {
            await this.afterList(hookParameters);
        }

        return hookParameters.listResult;

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
            const DerivedType = extendClass(baseTypes[baseType], { tableName: name, keyField: `${name}Id` }, configOrClass);
            this.map.set(name.toUpperCase(), DerivedType);
        }
    },
    get: function (name) {
        return this.map.get(name.toUpperCase());
    }
};

export { RelationshipTypes, BusinessBase, classMap, OperationMode };

export default BusinessBase;