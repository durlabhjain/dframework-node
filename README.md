# Purpose

This library is to facilate using Spraxa's DFramework related applications via NodeJS

# Usage

## Getting started
```
import Framework from 'dframework-node';

const framework = new Framework({
    logger
});
```

## Using Portal APIs

### Login for future use
```
const loggedIn = await framework.login({
    username: process.env.APP_USER,
    password: process.env.APP_PASSWORD,
});

if (!loggedIn) {
    logger.error('Login failed');
}
```

### Define application controllers

// create 2 controllers User and Item
framework.createControllers('User', 'Item');

### Getting list from a controller
```
const result = await framework.controllers.User.list({
    controller: 'User',
    listParameters: new portal.ListParameters({
        comboTypes: ['Role']
    })
});
```
### Loading a record
```
const result = await framework.controllers.User.get({
    id: 1
});
```
or
```
const result = await framework.controllers.User.get(1);
```
### Saving a record
```
const result = await framework.controllers.User.save({
    id: 1
    firstName: 'John',
    lastName: 'Doe'
});
```

## Using Raw SQL

### Initialize
```
const sqlConfig = {
    user: env.SQL_USER || env.USER,
    password: env.SQL_PASSWORD || env.PASSWORD,
    server: env.SQL_SERVER || env.SERVER,
    database: env.SQL_DATABASE || env.DATABASE,
    options: {
        trustServerCertificate: true,
    }
};

await DFramework.setSql(sqlConfig);
```

### Querying

#### Running query stored in a file

```
const fileName = 'queries/activeClients.sql';
const activeUsers = await framework.sql.query(fileName);
```

where fileName is the name of a file containing actual SQL query.

#### Running raw query

```
import { mssql } from 'dframework-node';
const request = framework.sql.createRequest();
request.input('IsActive', mssql.VarChar, 'Y');
const { recordset: activeUsers } = await framework.sql.query(`
    SELECT * FROM dbo.Users WHERE IsActive = @IsActive
`);
```

### Join

// TODO



## Using ElasticSearch

### Initialize

1. Create a file demo.esenv in environments folder with host information:
{
    "host": "http://0.0.0.0:9000",
    "name": "Demo"
}

2. Initialize code
```
const elasticConfig = {
    environment: env.ELASTIC_ENVIRONMENT || 'Demo'
};

await framework.setElastic(elasticConfig);
```

### Querying

```
const elasticResults = await framework.elastic.aggregate({
    query: 'myQuery',
    customize: this.customizeElasticQuery,  // function to customize elastic query
    mappings: {
        "Items": {
            root: "items",
            map: {
                "Transactions": "doc_count"
            }
        }
    }
});
```

// TODO: Explain parameters

### Logging

#### Configuration
1. Need to create config.json file on root of the project, which can be override with all config with local file like config.local.json
2. Configuration in the JSON file which has all default values which can change accordingly
```
{
     "logging": {
        "otherConfig": {
            "stdout": true,
            "httpConfig": {
                "url": "http://xyz.com/error_post",
                "headers": {}
            },
            postLevel: "error",
            stdout: true,
            logLevel: 'debug',
            logFolder: './logs',
            mixin: null,
        },
        "prettyPrint": {
            translateTime: 'SYS:yyyy-mm-dd h:MM:ss',
            ignore: '',
            colorize: true,
            singleLine: false,
            levelFirst: false,
        },
        "file": {
            frequency: '24h',
            verbose: false,
            max_logs: '10d',
            date_format: 'YYYY-MM-DD',
            size: '1m',
        }
    }
}
```

#### Example

```
import { logger } from '@durlabh/dframework';

logger.info("info");
logger.debug("debug");
logger.error("error");
logger.trace("trace");
```
