import Sql, { createQueryLogger } from "./sql.js";
import mysql from "mysql2/promise";


const getTypeByValue = function (value) {
	if ((value === null) || (value === undefined)) { return mysql.Types.VARCHAR }
  
	switch (typeof value) {
		case 'string':  
			return mysql.Types.VARCHAR;
  
	  	case 'number':
			if (value % 1 === 0) {
		  	return mysql.Types.INT24;
			} else {
		  		return mysql.Types.FLOAT;
			}
	  	case 'bigint': 
			return  mysql.Types.FLOAT;
  	  	case 'boolean':  
			return mysql.Types.BIT
	  	default:
			return mysql.Types.VARCHAR
	}
}


const convertParamsData = (value, type) => {
	switch (type) {
		case mysql.Types.TINY:
		case mysql.Types.SHORT:
		case mysql.Types.LONG:
		case mysql.Types.INT24:
		case mysql.Types.LONGLONG:
		case mysql.Types.FLOAT:
		case mysql.Types.DOUBLE:
		case mysql.Types.DECIMAL:
		  return Number(value);
		case mysql.Types.STRING:
		case mysql.Types.VAR_STRING:
		case mysql.Types.VARCHAR:
		  return String(value);
		case mysql.Types.DATE:
		case mysql.Types.DATETIME:
		case mysql.Types.TIMESTAMP:
		  return new Date(value);
		case mysql.Types.BIT:
		  return Boolean(value);
		// Add more cases as needed for different types
		default:
		  return value;
	  }
}
class Mysql extends Sql {
	
	dataTypes = {
		string: mysql.Types.VARCHAR,
		date: mysql.Types.DATETIME,
		integer: mysql.Types.INT24,
		boolean: mysql.Types.BIT,
		withDecimals: [mysql.Types.DECIMAL, mysql.Types.FLOAT],
		numeric: [mysql.Types.TINY, mysql.Types.INT24, mysql.Types.DECIMAL, mysql.Types.FLOAT, mysql.Types.SHORT, mysql.Types.LONG, mysql.Types.LONGLONG, mysql.Types.DOUBLE]
	}

	parameterPrefix = ":"

	setConfig({ logger, timeoutLogLevel = "info", queryLogThreshold = 1000, ...config } = {}) {
        if (logger) {
            this.logger = logger;
        }
        this.queryLogThreshold = queryLogThreshold;
        this.timeoutLogLevel = timeoutLogLevel;
        if (config) {
            this.pool = mysql.createPool(config);
        } else if (this.pool) {
            this.pool = null;
        }
    }

	allowTvp = false

	buildParameterName(paramName) {
        return ':' + paramName;
    }
	
	async runQuery({ request, type = "query", query, data = null }) {
        let result;
        try {
        if(type === "query") {
            result = await request.query(query, request.params);
        }
        else if(type === "execute") {
            result = await request.execute(query, request.params);
        }
        else {
            throw new Error("Unsupported Type");
        }
        return { sucess: true, data: result[0], ...result }
        }
        catch(err) {
            return { success: false, err, data: {} };
        }
    }


	createRequest() {
        const request = this.pool.request(), queryLogger = createQueryLogger(this);
        request.query = this.createProxy(request.query, queryLogger);
        request.execute = this.createProxy(request.execute, queryLogger);
		request.input = this.input;
		request.parameters = {};
        return request;
    }
	
	/**
   * Add an input parameter to the request.
   *
   * @param {String} name Name of the input parameter without : char.
   * @param {*} [type] SQL data type of input parameter. If you omit type, module automaticaly decide which MySQL data type should be used based on JS data type.
   * @param {*} value Input parameter value. `undefined` and `NaN` values are automatically converted to `null` values.
   * @return {Request}
   */
	input(name, type, value) {
		if (/--| |\/\*|\*\/|'/.test(name)) {
			throw new RequestError(`SQL injection warning for param '${name}'`, 'EINJECT');
		}
		if(arguments.length < 2) {
			throw new RequestError('Invalid number of arguments. At least 2 arguments expected.', 'EARGS');
		}
		else if(arguments.length === 2) {
			value = type;
			type = getTypeByValue(value);
		}
		else if(arguments.length === 3) {
			value = convertParamsData(value, type);
		}
		if (value === undefined) value = null 
		this.params[name] = value;
	}
}


export default Mysql;