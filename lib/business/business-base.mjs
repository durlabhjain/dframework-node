
import ExcelJS from "exceljs";
import path from "path";
import { performance } from 'perf_hooks';
import SqlHelper from './sql-helper.mjs';
import { sqlErrorMapper } from './error-mapper.mjs';
import mssql from '../wrappers/mssql.js';
import logger from '../logger.js';
import util from '../util.js';
import ConcatenatedColumn from "../concatenatedColumn.mjs";

const enums = {
    startDateTime: '00:00:00',
    endDateTime: '23:59:59',
    UniqueKeyErrorCode: 2627,
    UniqueIndexErrorCode: 2601,
    dateTime: 'dateTime',
    MAX_PARAMETERS_LIMIT: 2100
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

const dateTypeFields = ["date", "dateTime", "dateTimeLocal"]

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
    "equals": function ({ v, type }) {
        return { operator: '=', value: v === '' ? null : v, type: type };
    },
    "=": function ({ v, type }) {
        return { operator: '=', value: v === '' ? null : v, type: type };
    },
    "notEquals": function ({ v, type }) {
        return { operator: '!=', value: v === '' ? null : v, type: type };
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
    "greaterThan": function ({ v, type }) {
        return { operator: '>', value: v, type: type };
    },
    ">": function ({ v, type }) {
        return { operator: '>', value: v, type: type };
    },
    "lessThan": function ({ v, type }) {
        return { operator: '<', value: v, type: type };
    },
    "<": function ({ v, type }) {
        return { operator: '<', value: v, type: type };
    },
    "greaterThanOrEqual": function ({ v, type }) {
        return { operator: '>=', value: v, type: type };
    },
    ">=": function ({ v, type }) {
        return { operator: '>=', value: v, type: type };
    },
    "lessThanOrEqual": function ({ v, type }) {
        return { operator: '<=', value: v, type: type };
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
                toReturn = { operator: 'DATETIME', value: v, sqlType: enums.dateTime }
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
                return { operator: 'NOT BETWEEN DATE', value: v, sqlType: enums.dateTime, type: type };
            }
            return { operator: 'NOT BETWEEN', value: values, sqlType: mssql.VarChar, type: type };
        } else {
            return { operator: '!=', value: v, sqlType: mssql.VarChar, type: type };
        }
    },
    "onOrAfter": function ({ v, type }) {
        if (type === dateTimeEnum.DateTimeLocal) {
            return { operator: '>=', value: `${v}`, type: type };
        }
        return { operator: '>=', value: `${v} ${enums.startDateTime}`, type: type };
    },
    "onOrBefore": function ({ v, type }) {
        if (type === "dateTimeLocal") {
            let date = new Date(v);
            date = new Date(date.getTime() + 1000);
            const val = date.toISOString();
            return { operator: '<=', value: val, type: type };
        }
        return { operator: '<=', value: `${v} ${enums.endDateTime}`, type: type };
    },
    "after": function ({ v, type }) {
        if (type === "dateTimeLocal") {
            let date = new Date(v);
            date = new Date(date.getTime() + 1000);
            const val = date.toISOString();
            return { operator: '>', value: val, type: type };
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
        return { operator: 'IN', value: v, type: type };
    },
    "isTrue": function () {
        return { operator: '=', value: true };
    },
    "isFalse": function () {
        return { operator: '=', value: false };
    },
    "isBefore": function ({ v, type }) {
        return { operator: '<', value: v, type: type };
    },
    "isAfter": function ({ v, type }) {
        return { operator: '>', value: v, type: type };
    },
    "isOnOrBefore": function ({ v, type }) {
        return { operator: '<=', value: v, type: type };
    },
    "isOnOrAfter": function ({ v, type }) {
        return { operator: '>=', value: v, type: type };
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
compareLookups.isOnOrAfter = compareLookups['>='];

const extendClass = function (baseClass, config) {
    const newClass = class extends baseClass {
    }
    Object.assign(newClass.prototype, config);
    return newClass;
};

class BusinessBase {

    static businessObject = null;

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

    async createWhere({ alias = "Main", filterDeleted = true, selectedClients, applyClientFilter = true, globalFilters = {} } = {}) {
        const where = {};
        const { tags = {}, scopeId, iUserMarket } = this.user || {};
        const { ClientIds, Username, IsSuperAdmin } = tags;
        const { sql } = BusinessBase.businessObject;

        selectedClients = util.filterClients({ ClientIds, selectedClients, scopeId, IsSuperAdmin: Number(IsSuperAdmin) !== 0 });

        if ((selectedClients.length > 0 || globalFilters) && iUserMarket) {
            const listQuery = await util.loadUserFilterQuery({ username: Username, selectedClients, globalFilters, IsSuperAdmin: Number(IsSuperAdmin) != 0, sql, mssql });
            if (listQuery) {
                where["whereClause"] = { statement: listQuery };
            }
        }

        // Determine ClientId conditions
        if (applyClientFilter && selectedClients.length) {
            where[`${alias}.ClientId`] = { fieldName: "ClientId", operator: "IN", value: selectedClients };
        }

        if (filterDeleted) {
            where[`${alias}.IsDeleted`] = 0;
        }
        return where;
    }


    pluralize(str) {
        return str + 's';
    }

    async load({ id, relations }) {
        const { relations: definedRelations = [], keyField, multiSelectColumns = {} } = this;

        let query = this.getSelectStatement();

        const where = this.createWhere({ filterDeleted: this.standardTable });
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
                    query += `\r\nSELECT [${field}] AS ForeignId FROM [${relationTable}] WHERE IsDeleted = 0 AND [${keyField}] = @${keyField}`;
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

        if (!data.GroupName && this.groupNameKey) {
            data.GroupName = data[this.groupNameKey];
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

            // Process each result set
            multiSelectResults.forEach((resultSet) => {
                const { columnName } = resultSet;
                const datakey = Object.keys(resultSet).find(key => key !== 'columnName');
                if (!data[columnName]) data[columnName] = "";
                const values = new Set(data[columnName].split(",").map(v => v.trim()));
                values.add(resultSet[datakey]);
                data[columnName] = [...values].join(", ");
            });
        }

        return data;
    }

    async save({ id, relations, relationsObject, ...values }) {
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

    async saveRecord({ id, relations, ...values }) {
        if (this.beforeSave) {
            const result = await this.beforeSave({ id, ...values });
            values = { ...values, ...result };
        }
        const { relations: definedRelations = [], columnOverrideValue, multipleSurveyAllowedValue, multipleSurveyNotAllowedValue } = this;
        let requestValues = { ...values };
        if (requestValues && requestValues?.FrequencyType) {
            requestValues.MultipleSurveyAllowed = requestValues?.FrequencyType === columnOverrideValue ? multipleSurveyAllowedValue : multipleSurveyNotAllowedValue;
        }

        const relationsObject = {};
        for (const { foreignTable } of definedRelations) {
            relationsObject[foreignTable] = classMap.get(foreignTable);
        }

        if (this.fieldToUpdate) {
            requestValues = Object.assign({}, ...this.fieldToUpdate.map(key => key in values ? { [key]: values[key] } : {}));
        }

        if (!requestValues?.ClientId && this.addClientIdForSave) {
            requestValues.ClientId = this.user.scopeId
        }

        const result = await this.save({ id, relations, relationsObject, ...requestValues });

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
            const forgeinKey = childTable.foreignKey || keyField;
            await sql.query(`DELETE from ${childTable.tableName} WHERE ${forgeinKey} = ${id}`);
        }
        return await sql.query(`DELETE from ${tableName} WHERE ${keyField} = ${id}`);
    }

    async isSurveyStarted(id) {
        const request = this.createRequest();
        const query = `SELECT COUNT(1) as count FROM Survey WHERE SurveyMasterId = ${id}`;
        const result = await request.query(query);
        if (result?.recordset) {
            const count = result.recordset[0].count;
            return count > 0;
        } else {
            console.info('No data found in recordset.');
            return false;
        }
    }

    async isUsedInSurvey(id, keyField) {
        const request = this.createRequest();
        let query = null;
        if (keyField === 'SurveyTypeId') {
            query = `SELECT COUNT(1) as count FROM SurveyMaster WHERE SurveyTypeId LIKE '%${id}%'`;
        } else {
            query = `SELECT COUNT(1) as count FROM SurveyMasterAssignment WHERE PrimaryKeyId = ${id}`;
        }
        if (!query) return false;
        const result = await request.query(query);
        if (result?.recordset) {
            const count = result.recordset[0].count;
            return count > 0;
        } else {
            console.info('No data found in recordset.');
            return false;
        }
    }

    async deleteRecord({ id, ...values }) {
        const { keyField, errorMessage } = this;
        const isUsedInSurvey = this?.checkForActiveSurvey ? await this.isUsedInSurvey(id, keyField) : false;
        const isSurveyStarted = this?.checkForActiveSurvey ? await this.isSurveyStarted(id) : false;
        const itemToDelete = keyField === 'SurveyTypeId' ? 'Questionnaire' : errorMessage || this.tableName;
        if (isUsedInSurvey === true) {
            throw new Error(`You cannot remove the ${itemToDelete} as its used in survey`);
        }
        if (keyField === "SurveyMasterId" && isSurveyStarted === true) {
            throw new Error(`You cannot remove the survey`);
        }

        const response = await this.delete({ id, values });
        return response;
    }

    async delete({ id, values = {} }) {
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
            const forgeinKey = childTable.foreignKey || keyField;
            let updateStatement = 'IsDeleted = 1 ';
            if (childTable.useDeleteKey) {
                updateStatement += `, DeleteKey = ${childTable.tableName}.${forgeinKey} `;
            }
            await sql.query(`UPDATE ${childTable.tableName} SET ${updateStatement} WHERE ${forgeinKey} = ${id}`);
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

        listStatement = listStatement.replace(/^.+ FROM/i, `SELECT [${keyField}] value, [${displayField || sort}] label FROM `);

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
        const { sql } = BusinessBase.businessObject;
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
            query = sql.addParameters({ query: query, request, parameters: { _start: start, _limit: limit }, forWhere: false });
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
            const tableName = config.table || `${getTableName()}${colName}`;
            const foreignKey = config.column || colName;
            const typeOfForeignKey = config.type || "string";
            const useDeleteKey = config.useDeleteKey || false;
            const childRecordKeyField = config.keyField || `${tableName}Id`;
            const isNumber = typeOfForeignKey === "number";
            let newEntries = colValue.split(",");
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

    /**
   * Retrieves a list of records with optional filtering, sorting, grouping, and counting features.
   * This method supports sorting, filtering, and grouping of records.
   * It can also handle relations, counts, and includes/excludes specific records.
   *
   * @param {Object} options - The configuration options for listing records.
   * @param {number} [options.start=0] - The starting index for pagination records to list.
   * @param {number} [options.limit=100] - The maximum number of records to retrieve.
   * @param {string} [options.sort] - The sorting order of the records.
   * @param {Object} [options.filter] - The filter criteria for the records.
   * @param {string} [options.groupBy] - The field for grouping the results.
   * @param {string[]} [options.include] - Comma-separated list of fields to include in the results.
   * @param {string[]} [options.exclude] - Comma-separated list of fields to exclude from the results.
   * @param {boolean} [options.returnCount=true] - Whether to include the total count of records in the result.
   * @param {string} [options.logicalOperator='AND'] - The logical operator for combining filter conditions.
   * @param {boolean} [options.limitToSurveyed=false] - Whether to limit the results if the survey has been done on at least one outlet.
   * @returns {Object} - An object containing the retrieved records and optional total record count.
   *
   * @example
   * list({ start: 0, limit: 10, sort: 'name', filter: { name: 'John Doe' } })
   *     .then(data => console.log(data))
   *     .catch(error => console.error(error));
   *
   */
    async fetchRecords({ start = 0, limit = 100, sort, filter, groupBy, include, exclude, returnCount = true, logicalOperator = 'AND', limitToSurveyed = false, selectedClients = [], isChildGrid = false, globalFilters = {}, gridType = '', ...rest }) {
        globalFilters = typeof globalFilters === 'string' ? globalFilters = JSON.parse(globalFilters) : globalFilters;
        if (this.fetchFromMySql) return await this.fetchRecordFromMySql({ start, limit, sort, filter, groupBy, include, exclude, returnCount, logicalOperator, limitToSurveyed, selectedClients, isChildGrid, globalFilters, ...rest });
        sort = sort || this.defaultSortOrder;
        const request = this.createRequest();
        const { keyField, showCount, user, limitProps, concatenatedColumns } = this;
        const concatenatedColumn = new ConcatenatedColumn(concatenatedColumns);
        const { sql } = BusinessBase.businessObject;
        const clientId = user?.scopeId;
        isChildGrid = JSON.parse(isChildGrid);

        let totalStatement = "SELECT COUNT(1) AS TotalCount";

        const { relations = [] } = this;
        const parameters = {};

        filter = this.parseJson(filter, []);

        selectedClients = typeof selectedClients === 'string' ? JSON.parse(selectedClients) : selectedClients;

        const { tags = {} } = this.user || {};
        const { Username, IsSuperAdmin } = tags;
        const methodParameters = { filter, selectedClients, ClientId: this.user.scopeId, ClientIds: this.user.tags.ClientIds, gridType, globalFilters, IsSuperAdmin, Username, parameters, instance: this };
        let listStatement = await this.getListStatement(methodParameters);
        //#60444 - Handle demo-client logic
        if (this.queryFileName) {
            listStatement = await sql.getQuery(this.queryFileName);
        }
        if (this.isFromDemo) {
            listStatement = util.replaceClientWithDemo(listStatement);
        }
        if (this.updateFilters) {
            filter = this.updateFilters({ ...methodParameters, listStatement });
        }

        const whereArr = this.parseJson(filter, []);

        const isStandard = this.standardTable === true && (listStatement.indexOf("vw") === -1);
        const isDataFromView = listStatement.indexOf("vw") > -1 || this.useColumnField;
        const additionalColumns = [];
        if (isStandard) {
            listStatement += '\r\n LEFT OUTER JOIN (SELECT UserId Created_UserId, UserName as CreatedByUser FROM Security_User) Created_ ON Created_.Created_UserId = Main.CreatedByUserId'
            listStatement += '\r\n LEFT OUTER JOIN (SELECT UserId Modified_UserId, UserName as ModifiedByUser From Security_User) Modified_ ON Modified_.Modified_UserId = Main.ModifiedByUserId'
            additionalColumns.push('Created_.CreatedByUser', 'Modified_.ModifiedByUser');
        }
        if (isChildGrid) {
            listStatement += '\r\n LEFT OUTER JOIN (SELECT Tag.AssociationId, STRING_AGG(Tag.Name, \', \') AS TagNames FROM Tag WHERE Tag.IsDeleted = 0 GROUP BY Tag.AssociationId) [TagAggregated] ON [TagAggregated].AssociationId = Main.SmartDeviceId';
            additionalColumns.push(`[TagAggregated].TagNames AS Tags`);

        }
        for (const relation of relations) {
            const { relation: relationName, joinTable, field, countConfig, isActiveConfig } = relation;
            if (relation.countInList && relation.type === RelationshipTypes.OneToMany) {
                const additionalQuery = this.getRelationAdditionalQuery({ sql, request, relationWhere: relation.where });
                const relationTableName = relation.table || relationName;
                const foreignTableName = relation.foreignTable;
                const relationAlias = "Joined_" + foreignTableName;
                const isActiveWhere = isActiveConfig ? `AND ${relationAlias}.IsActive = 1` : "";
                const innerJoinStatement = `\r\n INNER JOIN ${foreignTableName} ${relationAlias} ON ${relationAlias}.${foreignTableName}Id = ${relationTableName}.${foreignTableName}Id`;
                const innerJoinWhere = `AND ${relationAlias}.ClientId = ${clientId} AND ${relationAlias}.IsDeleted = 0 ${isActiveWhere}`;

                let innerJoinQuery = "", innerCountsWhere = "";
                if (countConfig) {
                    innerJoinQuery = `\r\n INNER JOIN ${joinTable} ON ${joinTable}.${joinTable}Id = ${relationTableName}.${field}`;
                }
                const isActiveWhereP = isActiveConfig ? `AND ${joinTable}.IsActive = 1` : "";
                innerCountsWhere = countConfig ? `AND ${joinTable}.ClientId = ${clientId} AND ${joinTable}.IsDeleted = 0 ${isActiveWhereP}` : "";
                listStatement += `\r\n LEFT OUTER JOIN (SELECT ${relationTableName}.${keyField} ${relationName}_${keyField}, COUNT(1) as ${relationName}Count FROM [${relationTableName}] ${showCount ? innerJoinStatement : ''} ${innerJoinQuery} WHERE ${relationTableName}.IsDeleted = 0  ${showCount ? innerJoinWhere : ''} ${countConfig ? innerCountsWhere : ""} ${additionalQuery} GROUP BY ${relationTableName}.${keyField}) [${relationName}] ON [${relationName}].${relationName}_${keyField} = Main.${keyField}`;
                additionalColumns.push(`[${relationName}].${relationName}Count ${relationName}Count`);

            }
            if (relation.type === RelationshipTypes.OneToOne && relation.listColumns) {
                const join = [];
                for (const joinCondition of relation.join) {
                    join.push(`${relationName}.${joinCondition} = Main.${relation.join[joinCondition]}`)
                }
                listStatement += ` LEFT OUTER JOIN (SELECT ${relation.listColumns} FROM ${relationName} WHERE IsDeleted = 0) ${relationName} ON ${join.join(' AND ')}`
                additionalColumns.push(`${relationName}.${relationName}Count ${relationName}Count`);

            }
        }
        if (limitToSurveyed) {
            listStatement += limitToSurveyed ? `\r\n LEFT OUTER JOIN (SELECT ${limitProps.relation}.${limitProps?.field} ${limitProps.relation}_${limitProps?.field}, COUNT(1) as ${limitProps?.relation}Count FROM [${limitProps?.relation}]  WHERE ${limitProps.relation}.IsDeleted = 0 AND IsDeleted = 0 GROUP BY ${limitProps.relation}.${limitProps.field}) [${limitProps.relation}] ON [${limitProps.relation}].${limitProps.relation}_${limitProps.field} = Main.${limitProps.field}` : '';

        }
        if (additionalColumns.length > 0) {
            listStatement = listStatement.replace(/ from /i, ', ' + additionalColumns.join(', ') + ' FROM ');
        }

        let query = listStatement;
        const where = await this.createWhere({ filterDeleted: isStandard && !this.useStandardOnView, selectedClients, globalFilters, applyClientFilter: this.applyClientFilter });

        if (typeof include === 'string' && !isChildGrid) {
            include = include.split(',').map(item => Number(item));
        }
        if (typeof exclude === 'string') {
            exclude = exclude.split(',').map(item => Number(item));
        }
        if (typeof include === 'string' && isChildGrid) {
            include = JSON.parse(include);
        }
        if (typeof include === 'object' && isChildGrid) {
            for (const key in include) {
                if (Object.prototype.hasOwnProperty.call(include, key)) {
                    const value = include[key];
                    where[`Main.${key}`] = { fieldName: key, operator: "=", value: value };
                }
            }
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
        const filterObject = {};
        const filterArrayObject = {}
        if (whereArr.length) {
            whereArr.forEach((ele) => {
                const { operator, field, value, type, sqlType = null } = ele;
                const filterValue = compareLookups[operator]({ v: value, field, type });
                let fieldName = isDataFromView ? field : `Main.${field}`;
                if (filterFields[field] && isStandard) {
                    fieldName = `${filterFields[field]}.${field}`;
                }
                if (this.useAliasName === true) {
                    fieldName = `Main.${field}`;
                }
                if (!filterObject[fieldName]) {
                    filterObject[fieldName] = [];
                }
                if (typeof (filterValue) === 'string') {
                    where[fieldName] = { statement: filterValue.replaceAll('${field}', fieldName) }
                    filterObject[fieldName].push({ statement: filterValue.replaceAll('${field}', fieldName) })
                } else if (filterValue) {
                    where[fieldName] = { operator: filterValue.operator, value: filterValue.value, sqlType: sqlType ?? filterValue.sqlType, type: filterValue.type };
                    if (Array.isArray(filterValue.value) && filterValue.value.length) {
                        if (filterValue.value.length > enums.MAX_PARAMETERS_LIMIT) {
                            // Replace with whereClause to avoid SQL parameter limit error
                            where[fieldName] = {
                                statement: `${fieldName} IN (SELECT IntValue FROM CsvToInt('${filterValue.value.join()}'))`
                            };
                            filterArrayObject[fieldName] = (where[fieldName]);
                        } else {
                            filterObject[fieldName].push({ operator: filterValue.operator, value: filterValue.value, sqlType: sqlType ?? filterValue.sqlType, type: filterValue.type })
                        }
                    } else {
                        filterObject[fieldName].push({ operator: filterValue.operator, value: filterValue.value, sqlType: sqlType ?? filterValue.sqlType, type: filterValue.type })
                    }
                }
            })
        }


        const withClientId = {};

        for (const key in where) {
            if (!Object.prototype.hasOwnProperty.call(filterObject, key)) {
                withClientId[key] = where[key];
            }
        }
        const { where: whereF, whereQStatement } = util.getFilters({ filters: filterObject });
        query = sql.addParameters({ query, request, parameters: { ...withClientId, ...filterArrayObject }, forWhere: true });
        if (this?.addAdditionalFilters && clientId) {
            query = this.addAdditionalFilters({ query, where })
        }

        if (concatenatedColumns && !concatenatedColumns.length == 0) {
            const joinColumnValues = concatenatedColumns.map(item => item.DisplayColumn);
            for (const [index, joinColumnValue] of joinColumnValues.entries()) {
                // Check if the current joinColumnValue exists in whereArr
                const filterCondition = whereArr.find(condition => condition.field === joinColumnValue);
                if (filterCondition) {
                    const filterResult = await concatenatedColumn.applyStringFilter(where[filterCondition.field].value, concatenatedColumns[index], request);
                    const keyToReplace = Object.keys(whereQStatement).find(key => whereQStatement[key].includes(joinColumnValue));
                    if (keyToReplace !== undefined) {
                        whereQStatement[keyToReplace] = filterResult;
                    }
                }
            }
        }
        if (whereQStatement.length) {
            const whereQuery = ` ${Object.keys(withClientId).length ? 'AND' : 'WHERE'} (${whereQStatement.join(` ${logicalOperator.toUpperCase()} `)})`
            query += whereQuery
            if (filterArrayObject) {
                query = sql.addParameters({ query, request, parameters: filterArrayObject, forWhere: false });
            }
            query = sql.addParameters({
                query, request, parameters: {
                    ...whereF,
                }, forWhere: false
            });
        }

        if (limitToSurveyed) {
            query += ` AND ${limitProps.relation}.${limitProps.relation}Count ${limitProps.operator} ${limitProps.value}`;
        }
        start = Number(start);
        limit = Number(limit);

        const needToGetCount = returnCount && limit > 0;

        const sortStatement = sort ? ' ORDER BY ' + sort.trim().split(',').map(field => SqlHelper.sanitizeField(field)).join(', ') : '';

        if (needToGetCount) {
            //The current totalCount logic for queries using CTE does not handle nested CTEs or complex FROM clauses correctly. Refactor to accurately extract the FROM clause and count rows for all CTE scenarios
            if (/^with/i.test(query)) { // To check if the query starts with a CTE
                const [beforeSelect, afterFrom] = util.splitQueryBasedOnFrom({ query });
                totalStatement = beforeSelect + totalStatement + afterFrom;
            } else {
                const match = / from /i.exec(query);
                totalStatement += query.substring(match.index);
            }
        }

        if (groupBy) {
            let groupByFields = groupBy.split(',');
            groupByFields = groupByFields.map(field => SqlHelper.sanitizeField(field));
            const groupByStatement = ' GROUP BY ' + SqlHelper.sanitizeField(groupByFields.join(', '), true);
            query += groupByStatement;
            totalStatement += groupByStatement;
            query += sortStatement;
        }

        if (needToGetCount) {
            if (limitToSurveyed) {
                totalStatement += ` AND ${limitProps.relation}.${limitProps.relation}COUNT ${limitProps.operator} ${limitProps.value}`
            }
            query += sortStatement;

            if (limit > 0) {
                query += ' OFFSET @_start ROWS FETCH NEXT @_limit ROWS ONLY';
                query = sql.addParameters({ query: query, request, parameters: { _start: start, _limit: limit }, forWhere: false });
            }
        }

        query += ';';

        if (needToGetCount) {
            query += totalStatement;
        }

        if (Object.keys(parameters).length) {
            query = sql.addParameters({ query, request, parameters, forWhere: false });
        }

        const startTime = performance.now();
        let result = await sql.runQuery({ request, type: "query", query });
        if (this.addExecutionTimeLogger) {
            const endTime = performance.now();
            logger.info(`Execution time taken for query execution: ${endTime - startTime} ms`);
        }

        if (result.err) throw result.err;
        if (concatenatedColumns && !concatenatedColumns.length == 0) {
            const startTimeConcat = performance.now();
            const resultValue = await concatenatedColumn.AddColumns(result);
            if (resultValue !== null && resultValue !== undefined) {
                result = resultValue;
            }
            if (this.addExecutionTimeLogger) {
                const endTimeConcat = performance.now();
                logger.info(`Execution time taken for concatenated columns: ${endTimeConcat - startTimeConcat} ms`);
            }
        }

        if (this.customizeList && typeof this.customizeList === 'function') {
            result.recordset = await this.customizeList({ records: result.recordset, ...rest });
        }

        if (this.createDynamicColumns && typeof this.createDynamicColumns === 'function') {
            result.dynamicColumns = await this.createDynamicColumns({ records: result.recordset, ...rest });
        }


        if (returnCount) {
            let recordCount;

            if (limit > 0) {
                recordCount = result.recordsets[1][0].TotalCount;
            } else {
                recordCount = result.rowsAffected[0];
            }

            return {
                records: result.recordset,
                recordCount,
                dynamicColumns: result.dynamicColumns || [],
            }
        } else {
            return {
                records: result.recordset
            }
        }

    }

    async fetchRecordFromMySql({ start = 0, limit = 100, sort, filter, groupBy, returnCount = true, selectedClients = [], logicalOperator = 'AND', dataGroupBy, globalFilters = {}, ...rest }) {
        sort = sort || this.defaultSortOrder;
        const { mysql } = BusinessBase.businessObject;
        const request = mysql.createRequest();
        let totalStatement = "SELECT COUNT(1) AS TotalCount";
        selectedClients = typeof selectedClients === 'string' ? JSON.parse(selectedClients) : selectedClients;
        groupBy = groupBy && typeof groupBy === 'string' ? JSON.parse(groupBy) : groupBy;
        filter = this.parseJson(filter, []);
        const { tags = {} } = this.user || {};
        const { Username, IsSuperAdmin } = tags;
        const listStatement = await this.getListStatement({ filter, selectedClients, ClientId: this.user.scopeId, ClientIds: this.user.tags.ClientIds, dataGroupBy, IsSuperAdmin, Username, globalFilters, ...rest });
        if (this.updateFilters) {
            filter = this.updateFilters({ filter });
        }
        const whereArr = this.parseJson(filter, []);
        const isStandard = this.standardTable === true && (listStatement.indexOf("vw") === -1);
        const isDataFromView = listStatement.indexOf("vw") > -1;
        let query = listStatement;
        const where = await this.createWhere({ filterDeleted: isStandard && !this.useStandardOnView, selectedClients, globalFilters });
        Object.keys(where).forEach(key => {
            const newKey = key.replace(/_/g, '');
            if (newKey !== key) {
                where[newKey] = where[key];
                delete where[key];
            }
        });
        const filterObject = {};
        if (whereArr.length) {
            whereArr.forEach((ele) => {
                const { operator, field, value, type, sqlType = null } = ele;
                const filterValue = compareLookups[operator]({ v: value, field, type });
                let fieldName = isDataFromView ? field : `Main.${field}`;
                if (filterFields[field] && isStandard) {
                    fieldName = `${filterFields[field]}.${field}`;
                }
                if (this.useAliasName === true) {
                    fieldName = `Main.${field}`;
                }
                if (!filterObject[fieldName]) {
                    filterObject[fieldName] = [];
                }
                if (typeof (filterValue) === 'string') {
                    where[fieldName] = { statement: filterValue.replaceAll('${field}', fieldName) }
                    filterObject[fieldName].push({ statement: filterValue.replaceAll('${field}', fieldName) })
                } else if (filterValue) {
                    where[fieldName] = { operator: filterValue.operator, value: filterValue.value, sqlType: sqlType ?? filterValue.sqlType, type: filterValue.type };
                    if (Array.isArray(filterValue.value)) {
                        if (filterValue.value.length) {
                            filterObject[fieldName].push({ operator: filterValue.operator, value: filterValue.value, sqlType: sqlType ?? filterValue.sqlType, type: filterValue.type })
                        }
                    } else {
                        filterObject[fieldName].push({ operator: filterValue.operator, value: filterValue.value, sqlType: sqlType ?? filterValue.sqlType, type: filterValue.type })
                    }
                }
            })
        }


        const withClientId = {};

        for (const key in where) {
            if (!Object.prototype.hasOwnProperty.call(filterObject, key)) {
                withClientId[key] = where[key];
            }
        }
        const { where: whereF, whereQStatement } = util.getFilters({ filters: filterObject, action: '', aliasTableName: '', prefix: ':', useUpperFunction: true });
        query = mysql.addParameters({ query, request, parameters: withClientId, forWhere: true });

        if (whereQStatement.length) {
            const whereQuery = ` ${Object.keys(withClientId).length ? 'AND' : 'WHERE'} (${whereQStatement.join(` ${logicalOperator.toUpperCase()} `)})`
            query += whereQuery
            query = mysql.addParameters({
                query, request, parameters: {
                    ...whereF,
                }, forWhere: false
            });
        }
        start = Number(start);
        limit = Number(limit);

        const needToGetCount = returnCount && limit > 0;

        if (needToGetCount) {
            const match = / from /i.exec(query);
            totalStatement += query.substring(match.index);
        }

        if (groupBy) {
            let groupByFields = Array.isArray(groupBy) ? groupBy : groupBy.split(',');
            groupByFields = groupByFields.map(field => SqlHelper.sanitizeField(field));
            const groupByStatement = ' GROUP BY ' + groupByFields.join(', ');
            query += groupByStatement;
            totalStatement += groupByStatement;
        }

        if (needToGetCount) {
            if (sort) {
                let orderByFields = sort.split(',');
                orderByFields = orderByFields.map(field => SqlHelper.sanitizeField(field));
                query += ' ORDER BY ' + orderByFields.join(', ');
            }

            if (limit > 0) {
                query += ' LIMIT :start, :limit';
                query = mysql.addParameters({ query: query, request, parameters: { start: start, limit: limit }, forWhere: false });
            }
        }

        query += ';';

        if (needToGetCount) {
            query += totalStatement;
        }

        const result = await mysql.runQuery({ request, type: "query", query });

        if (result.err) {
            throw result.err;
        }

        if (returnCount) {

            if (this.customizeList && typeof this.customizeList === 'function') {
                result[0][0] = await this.customizeList({ records: result[0][0] });
            }
            let recordCount;

            if (limit > 0) {
                recordCount = result[0][1][0]?.TotalCount || 0;
            }

            return {
                records: needToGetCount ? result[0][0] : result[0],
                recordCount
            }
        }

    }
    async import({ attachmentPath }) {
        const lookup = await this.loadLookups();
        const clientConfig = this.importConfig.clientConfig ? await util.getClientConfig({ label: this.importConfig.clientConfig.label, clientId: this.user.scopeId }) : {}
        const excelFilePath = path.join(process.cwd(), attachmentPath);
        const { sql } = BusinessBase.businessObject;
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(excelFilePath);
        const worksheet = workbook.getWorksheet(1);
        const result = this.validateAndFillWorkSheet({
            worksheet,
            lookup,
            clientConfig
        });
        // Check if file is empty (only contains headers or no data)
        if (worksheet.rowCount <= 1) {
            const errors = [{
                rowNumber: 0,
                error: "Empty File",
                message: "Empty file: Please fill the data"
            }];
            sql.insert({ Grid: this.gridName, Errors: JSON.stringify(errors), ImportedRecords: 0, ClientId: this.user.scopeId, CreatedByUserId: this.user.id, ModifiedByUserId: this.user.id }, "MasterDataImportLog");
            return { errors, successfulRecords: 0 };
        }
        let data = result.data;
        const errors = result.errors;
        const rowCount = result.rowCount ? result.rowCount : 0;
        let count = data?.length > 0 ? data.length : 0;
        if (count > 0 && rowCount <= util.importLimit) {
            try {
                data = await this.modifyData({ data, tableName: this.tableName, errors });
                const tvp = this.createTVP(data);
                const request = sql.createRequest();
                request.input("ClientId", mssql.Int, this.user.scopeId);
                request.input("UserId", mssql.Int, this.user.id);
                request.input("ImportData", mssql.TVP, tvp);
                await request.execute(this.importSP);
                count = tvp.rows.length;
            } catch (error) {
                const text = sqlErrorMapper.map(error.message);
                errors.push({
                    rowNumber: 0,
                    error: "Data Error",
                    message: text || error.message
                });
                return { errors, successfulRecords: 0 };
            }
        }
        if (rowCount > util.importLimit) {
            errors.length = 0;
            errors.push({
                rowNumber: 0,
                error: "Maximum Rows Exceeds",
                message: `You can only import ${util.importLimit} rows at a time`
            });
            count = 0;
        }
        sql.insert({ Grid: this.gridName, Errors: errors.length > 0 ? JSON.stringify(errors) : null, ImportedRecords: count, ClientId: this.user.scopeId, CreatedByUserId: this.user.id, ModifiedByUserId: this.user.id }, "MasterDataImportLog");
        return { errors: errors, successfulRecords: count };
    }

    validateAndFillWorkSheet({ worksheet, lookup, clientConfig }) {
        const errors = [];
        const columns = Object.keys(this.importConfig.columns);
        const excelColumns = [];
        worksheet
            .getRow(1).eachCell({ includeEmpty: false }, (cell) => {
                if (cell.value) excelColumns.push(cell.value.trim())
            })
        const missingColumnsInExcel = columns.filter(
            (column) => !excelColumns.includes(column)
        );
        const extraColumnsInExcel = excelColumns.filter(
            (column) => !columns.includes(column)
        );
        if (missingColumnsInExcel.length > 0) {
            errors.push({
                rowNumber: 0,
                error: "Missing Columns",
                message: `The following columns are missing: ${missingColumnsInExcel.join(
                    ", "
                )}`
            });
        }
        if (extraColumnsInExcel.length > 0) {
            errors.push({
                rowNumber: 0,
                error: "Extra Columns",
                message: `The following columns are extra: ${extraColumnsInExcel.join(
                    ", "
                )}`
            });
        }
        if (errors.length > 0) {
            return { data: null, errors };
        }
        const validRows = [];
        const primaryKeyValues = [];
        let rowCount = 0;
        worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            if (rowNumber === 1) return;
            rowCount++;
            const rowData = {};
            let validRow = true;
            for (const column of columns) {
                const columnIndex = excelColumns.indexOf(column);
                const columnConfig = this.importConfig.columns[column];
                const originalValue = row._cells[columnIndex]?.value === undefined
                    ? null
                    : typeof row._cells[columnIndex]?.value === 'object' && row._cells[columnIndex]?.value !== null
                        ? row._cells[columnIndex]?.isHyperlink
                            ? row._cells[columnIndex]?.value?.text
                            : row._cells[columnIndex]?.value?.result
                        : row._cells[columnIndex]?.value;
                let value = originalValue;
                if (value === '') value = null;
                if (columnConfig.isPrimaryKey && value !== null) {
                    if (primaryKeyValues.includes(value)) {
                        errors.push({
                            rowNumber,
                            error: `Duplicate Value: ${column}`,
                            message: `Duplicate values for ${column} are not allowed.`
                        });
                        validRow = false;
                        break;
                    }
                    primaryKeyValues.push(value);
                }
                if (columnConfig.requiredBasedOnClientConfig && !columnConfig.notRequiredWith) {
                    let configValue = clientConfig[columnConfig.clientConfigKey];
                    if (columnConfig.clientConfigJsonValue) {
                        try {
                            configValue = JSON.parse(configValue)[columnConfig.clientConfigJsonValue];
                        } catch {
                            configValue = false;
                        }
                    }
                    if (configValue === "true" && value === null) {
                        errors.push({
                            rowNumber,
                            error: "Required Column",
                            message: `Missing required data in column: ${column}`
                        });
                        validRow = false;
                    }
                }
                if (columnConfig.required && value === null) {
                    errors.push({
                        rowNumber,
                        error: "Required Column",
                        message: `Missing required data in column: ${column}`
                    });
                    validRow = false;
                }
                if (columnConfig.requiredWith) {
                    if (!value && rowData[columnConfig.requiredWith.dataIndex].originalValue) {
                        errors.push({
                            rowNumber,
                            error: "Required Column",
                            message: `Missing required data in column: ${column}`
                        });
                        validRow = false;
                    }
                }
                if (columnConfig.notRequiredWith) {
                    if (value && !rowData[columnConfig.notRequiredWith.dataIndex].value) {
                        errors.push({
                            rowNumber,
                            error: "Unwanted Value",
                            message: `${column} is required only when there is data in column: ${columnConfig.notRequiredWith.header}`
                        });
                        validRow = false;
                    }
                    if (columnConfig.requiredBasedOnClientConfig && rowData[columnConfig.notRequiredWith.dataIndex].value) {
                        let configValue = clientConfig[columnConfig.clientConfigKey];
                        if (columnConfig.clientConfigJsonValue) {
                            try {
                                configValue = JSON.parse(configValue)[columnConfig.clientConfigJsonValue];
                            } catch {
                                configValue = false;
                            }
                        }
                        if (configValue === "true" && value === null) {
                            errors.push({
                                rowNumber,
                                error: "Required Column",
                                message: `Missing required data in column: ${column}`
                            });
                            validRow = false;
                        }
                    }
                }
                if (columnConfig.requiredWithout && !value) {
                    if (!rowData[columnConfig.requiredWithout.dataIndex].value) {
                        errors.push({
                            rowNumber,
                            error: "Required Column",
                            message: `${column} is required when there is no data in ${columnConfig.requiredWithout.header}`
                        })
                        validRow = false;
                    }
                }
                if (value !== null) {
                    const result = this.validateAndConvertDataType({ value, columnConfig, errors, validRow, rowNumber });
                    value = result.value;
                    validRow = result.validRow;
                }
                if (columnConfig.shouldNotbe && columnConfig.shouldNotbe == value) {
                    errors.push({
                        rowNumber,
                        error: "Invalid Value",
                        message: `Given value is not valid for the column: ${column}`
                    })
                    validRow = false;
                }
                if (columnConfig.minValue && columnConfig.minValue > value) {
                    errors.push({
                        rowNumber,
                        error: "Invalid Value",
                        message: `Value for column "${column}" must be at least ${columnConfig.minValue}`
                    })
                    validRow = false;
                }
                if (columnConfig.maxValue != undefined && columnConfig.maxValue < Number(value)) {
                    errors.push({
                        rowNumber,
                        error: "Invalid Value",
                        message: `Value for column "${column}" must be at most ${columnConfig.maxValue}`
                    })
                    validRow = false;
                }
                if (columnConfig.isWholeNumber && ((Number(value) - Math.floor(Number(value))) !== 0)) {
                    errors.push({
                        rowNumber,
                        error: "Invalid Value",
                        message: `Value for column "${column}" must be a whole number`
                    })
                    validRow = false;
                }
                columnConfig.uniqueWith?.forEach(item => {
                    if (originalValue !== null) {
                        if (columnConfig.oneToMany) {
                            const originalValueArray = originalValue.split(",");
                            originalValueArray.forEach(originalValueItem => {
                                if (originalValueItem === rowData[item.dataIndex].originalValue) {
                                    errors.push({
                                        rowNumber,
                                        error: "Same Value Not Allowed",
                                        message: `${columnConfig.header} cannot be the same as ${item.header}`
                                    })
                                    validRow = false;
                                    return;
                                }
                            });
                        } else {
                            if (originalValue === rowData[item.dataIndex].originalValue) {
                                errors.push({
                                    rowNumber,
                                    error: "Same Value Not Allowed",
                                    message: `${columnConfig.header} cannot be the same as ${item.header}`
                                })
                                validRow = false;
                            }
                        }
                    }
                });
                if (columnConfig.regex && value !== null) {
                    value.split(",").forEach(item => {
                        if (typeof item === 'string') item = item.trim();
                        if (!columnConfig.regex.test(item)) {
                            errors.push({
                                rowNumber,
                                error: "Invalid Data Format",
                                message: `Invalid data format for column: ${column}`
                            });
                            validRow = false;
                        }
                    })
                }
                if (columnConfig.maxLength < value?.length) {
                    errors.push({
                        rowNumber,
                        error: "Column Length",
                        message: `"${column}" exceeds the maximum allowed length (${columnConfig.maxLength})`
                    });
                    validRow = false;
                }
                if (columnConfig.lookupType && value != null) {
                    if (columnConfig.oneToMany) {
                        value = value.split(",").map(item => item.trim());
                        for (let i = 0; i < value.length; i++) {
                            let lookupData = lookup[columnConfig.lookupType][value[i].toUpperCase()];
                            if (columnConfig.lookupDependency) {
                                lookupData = lookupData[columnConfig.lookupDependency] === rowData[columnConfig.lookupDependency].value || lookupData[columnConfig.lookupDependency] === columnConfig.defaultLookupDependency ? lookupData : null;
                            }
                            if (!lookupData) {
                                errors.push({
                                    rowNumber,
                                    error: "Invalid Value",
                                    message: `Provided value does not exist: ${column}`
                                });
                                validRow = false;
                                break;
                            }
                            value[i] = lookupData?.LookupId;
                        }
                        value = value.join(",");
                    }
                    else {
                        let lookupData = lookup[columnConfig.lookupType][value.toUpperCase().trim()];
                        if (columnConfig.lookupDependency && lookupData) {
                            lookupData = lookupData[columnConfig.lookupDependency] === rowData[columnConfig.lookupDependency].value || lookupData[columnConfig.lookupDependency] === columnConfig.defaultLookupDependency ? lookupData : null;
                        }
                        if (!lookupData) {
                            errors.push({
                                rowNumber,
                                error: "Invalid Value",
                                message: `Provided value does not exist: ${column}`
                            });
                            validRow = false;
                        }
                        value = lookupData?.LookupId;
                    }
                }
                if (columnConfig.uniqueOn && value) {
                    const lookupData = lookup[columnConfig.dataIndex][value.toUpperCase().trim()];
                    if (lookupData) {
                        if (lookupData[columnConfig.uniqueOn] != rowData[columnConfig.uniqueOn].value) {
                            errors.push({
                                rowNumber,
                                error: "Already Exist",
                                message: `Provided value already exist in another record: ${column}`
                            });
                            validRow = false;
                        }
                    }
                    const valueExistInPreviousRecords = validRows.some(obj => obj[columnConfig.dataIndex].value === value);
                    if (valueExistInPreviousRecords) {
                        errors.push({
                            rowNumber,
                            error: "Already Exist",
                            message: `Provided value already exist in another record: ${column}`
                        });
                        validRow = false;
                    }
                }
                if (columnConfig.defaultValue != undefined && !value) {
                    value = columnConfig.defaultValue
                }
                rowData[columnConfig.dataIndex] = { value, originalValue };
            }
            if (validRow || this.tableName === "MasterPlanogram") validRows.push(rowData);
        });

        return { data: validRows, errors, rowCount };
    }

    validateAndConvertDataType({ value, columnConfig, errors, validRow, rowNumber }) {
        const type = columnConfig.dataType ? columnConfig.dataType : 'string';
        switch (type) {
            case "string":
                value = String(value).trim();
                break;
            case "number":
                if (isNaN(value)) {
                    value = null;
                    errors.push({
                        rowNumber,
                        error: "Invalid Value",
                        message: `Invalid data type in column: ${columnConfig.header}`
                    })
                    validRow = false;
                }
                else {
                    value = Number(value);
                    if (columnConfig.fixed) value = value.toFixed(columnConfig.fixed)
                }
                break;
            case "boolean":
                value = typeof value === 'number' ? false : value.toLowerCase() === 'yes';
                break;
            default:
                value = String(value).trim();
                break;
        }
        return { value, validRow }
    }

    createTVP(rowData) {
        const tvp = new mssql.Table();
        const columns = this.importConfig.customImportColumn || this.importConfig.columns
        if (this.importConfig != "MasterPlanogram")
            tvp.columns = Object.values(columns).map((col) => ({
                name: col.dataIndex,
                type: col.type,
                defaultValue: col.defaultValue != undefined ? col.defaultValue : null,
            }));
        rowData.forEach((rowData) => {
            tvp.rows.add(
                ...Object.values(columns).map(
                    (col) => rowData[col.dataIndex].value
                )
            );
        });
        return tvp;
    }

    async modifyData({ data, tableName, errors }) {
        let newData = [];
        const { sql } = BusinessBase.businessObject;
        switch (tableName) {
            case "MasterPlanogram":
                newData = await util.modifyPlanogramImportData({ data, clientId: this.user.scopeId, errors, sql });
                data.length = 0;
                data.push(...newData);
                break;
            case "MasterUser":
                data = util.modifyUserImportData(data);
        }
        return data;
    }

    async loadLookups() {
        const lookupTypes = this.importConfig.lookupTypes;
        const lookup = {};
        const { sql } = BusinessBase.businessObject;
        for (const lookupType of lookupTypes) {
            const type = lookupType.type;
            const typeId = lookupType.typeId;
            lookup[type] = await util.getLookup({ lookupType: typeId, user: this.user, sql });
        }
        return lookup;
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
            const DerivedType = extendClass(baseTypes[baseType], { standardTable: true, clientBased: true, tableName: name, keyField: `${name}Id`, ignoreClientFilter: false, addClientIdForSave: false, checkForActiveSurvey: true, applyClientFilter: true, addExecutionTimeLogger: false, useColumnField: false, ...configOrClass });
            this.map.set(name.toUpperCase(), DerivedType);
        }
    },
    get: function (name) {
        return this.map.get(name.toUpperCase());
    }
};

export { RelationshipTypes, BusinessBase, classMap, compareLookups };

export default BusinessBase;