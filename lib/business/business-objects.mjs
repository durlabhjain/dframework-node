import { unlinkSync } from 'fs';
import path from "path";
import util from '../util.js';
import queryBase from './query-base.mjs';
import { classMap } from '../business/business-base.mjs';
import lookup from '../business/lookup.mjs';
import ElasticBusinessBase from './elastic-business-base.mjs'
import responseTransformer from '../middleware/response-transformer.mjs';
import { upload } from "../middleware/attachment.mjs";
import enums from '../enums.mjs';
import BusinessBase from '../business/business-base.mjs';

function resTransform(req, res, next) {
  responseTransformer(req, res, next);
}

class BusinessBaseObjectsRouter {
  constructor(router, businessObjectConfigs) {
    this.router = router;
    this.init(businessObjectConfigs);
    this.setupRoutes();
  }

  init(businessObjectConfigs) {
    for (const businessObjectName in businessObjectConfigs) {
      classMap.baseTypes = { ...classMap.baseTypes, ...{ 'elastic': ElasticBusinessBase } }
      classMap.register(businessObjectName, businessObjectConfigs[businessObjectName]);
    }
  }

  setupRoutes() {
    this.router.use('/:businessObjectName', (req, res, next) => {
      const businessObjectName = req.params.businessObjectName.toUpperCase().replaceAll('-', '');
      const constructor = classMap.get(businessObjectName);
      if (!constructor) {
        throw new Error(`Business object ${req.params.businessObjectName} not found.`);
      }
      const businessObject = new constructor();
      businessObject.user = req.user;
      businessObject.isFromDemo = util.isFromDemo(req);
      // Pass the request logger (req.log or req.logger) if available
      if (req.log) {
        businessObject.logger = req.log;
      } else if (req.logger) {
        businessObject.logger = req.logger;
      }
      req.businessObject = businessObject;
      next();
    });

    this.router.use(resTransform);

    this.router.get('/:businessObjectName/lookups', queryBase(async (req) => {
      const { businessObject } = req;
      const { lookups, scopeId } = { ...req.query, ...req.body };
      return {
        success: true,
        data: await this.getLookups({ lookups, user: { ...businessObject.user, scopeId }, tableLookupFields: BusinessBase.tableLookupFields })
      };
    }));

    this.router.post('/:businessObjectName/list', queryBase(async (req, res) => {
      const { businessObject } = req;
      const { start, limit, sort, groupBy, include, exclude, where, filename, columns, lookups, logicalOperator, responseType, isElasticExport: isElastic, limitToSurveyed, fileName, fromSelfServe, userTimezoneOffset, selectedClients, isChildGrid, isDetailsExport = false, isLatestExport = false, globalFilters = {}, gridType, ...rest } = req.body;
      let isMultiSheetExport = false;
      if (fromSelfServe === 'true' && businessObject.tableName == "MasterPlanogram") {
        const filePath = path.join(process.cwd(), 'planogram.xlsx');
        res.setHeader('Content-Disposition', `attachment; filename="Planogram Import.xlsx"`);
        return res.sendFile(filePath);
      }
      const data = await businessObject.fetchRecords({ start, limit, sort, filter: where, groupBy, include, exclude, columns: fromSelfServe === 'true' ? businessObject.importConfig.exportColumns : columns, logicalOperator, responseType, isElastic: Boolean(isElastic), limitToSurveyed, selectedClients, isChildGrid, isDetailsExport, isLatestExport, globalFilters, req, gridType, ...rest });

      if (filename) {
        res.attachment(filename);
      }
      if (data.records?.isMultiSheetExport) {
        isMultiSheetExport = true;
        data.records = data.records.sheets;
      }

      return {
        success: true,
        ...data,
        exportColumns: JSON.parse(columns || "[]"),
        userDateTimeFormat: businessObject.user.tags?.DateTimeFormat?.toUpperCase(),
        userDateFormat: businessObject.user.tags?.DateFormat?.toUpperCase(),
        userCurrencySymbol: businessObject.user.tags?.CurrencySymbol,
        lookups: await this.getLookups({ lookups, user: businessObject.user, tableLookupFields: businessObject.tableLookupFields }),
        isElastic: Boolean(isElastic),
        fileName
      };
    }, { data: 'records' }));

    this.router.get('/:businessObjectName/:id', queryBase(async (req) => {
      const { businessObject } = req;
      const { id } = req.params;
      const { relations, lookups } = { ...req.query, ...req.body };
      const data = await businessObject.load({ id, relations });
      return {
        success: true,
        data,
        lookups: await this.getLookups({ lookups, user: businessObject.user, tableLookupFields: businessObject.tableLookupFields })
      };
    }));

    this.router.put('/:businessObjectName/:id', queryBase(async (req) => {
      const { businessObject } = req;
      const { id } = req.params;
      const { relations } = req.body;

      const data = await businessObject.saveRecord({ id, relations, ...req.body });
      return { success: true, data, lookups: {} };
    }));

    this.router.delete('/:businessObjectName/:id', queryBase(async (req, res) => {
      const { businessObject } = req;
      const { id } = req.params;
      try {
        const data = await businessObject.deleteRecord({ id, ...req.body });
        res.status(200).json({ success: true, data, lookups: {} });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message || 'An unexpected error occurred.' });
      }
    }));

    this.router.post('/:businessObjectName/import', upload.array("importFile"), queryBase(async (req, res) => {
      const { businessObject } = req;
      const module = req.user.modules[businessObject.securityModule];
      if (req.files.length === 0) {
        res.send({ errors: [{ error: "No Files Attached", message: "Please attach at least 1 file for importing." }] });
        return;
      }
      if (req.files.length > 1) {
        res.send({ errors: [{ error: "Too Many Files", message: "Please attach only 1 file for importing." }] });
        return;
      }
      if (path.extname(req.files[0].path?.toLowerCase()) != '.xlsx') {
        res.send({ errors: [{ error: "Wrong File Type", message: "Please provide an xlsx file for importing." }] });
        return;
      }
      if (!util.canAdd(module)) {
        res.send({ errors: [{ error: "Unauthorised", message: "You do not have permission to import data" }] });
        return;
      }
      if (req.user.scopeId <= 0) {
        res.send({ errors: [{ error: "Unauthorised", message: "You do not have a client assigned." }] });
        return;
      }
      const data = await businessObject.import({
        attachmentPath: req.files[0].path,
      });
      unlinkSync(path.join(process.cwd(), req.files[0].path));
      res.send(data);
    }))
  }

  async getLookups({ lookups, user = {}, tableLookupFields = {} }) {
    if (!lookups) {
      return;
    }
    const tableLookupTypes = BusinessBase.tableLookupTypes || {};
    const lookupTypes = lookups.trim().length ? lookups.split(',') : [];
    if (lookupTypes.length) {
      const lookupResult = {};
      for (const lookupType of lookupTypes) {
        const nameOrId = lookupType.trim();
        if (tableLookupTypes[nameOrId]) {
          const { typeId } = tableLookupTypes[nameOrId];
          lookupResult[nameOrId] = await util.getLookup({ lookupType: typeId, user, isForImport: false, tableLookupFields });
        } else {
          lookupResult[nameOrId] = await lookup.get(user, nameOrId);
        }
      }
      return lookupResult;
    }
  }
}

export default BusinessBaseObjectsRouter;

