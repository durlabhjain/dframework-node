import queryBase from './query-base.mjs';
import { classMap } from '../business/business-base.mjs';
import lookup from '../business/lookup.mjs';
import ElasticBusinessBase from './elastic-business-base.mjs'
import responseTransformer from '../middleware/response-transformer.mjs';
import logger from '../logger.js';

function resTransform(req, res, next) {
  responseTransformer(req, res, next);
}

class BusinessBaseObjectsRouter {
  constructor(router, businessObjectConfigs) {
    this.router = router
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
      req.businessObject = businessObject;
      next();
    });

    this.router.use(resTransform);

    this.router.get('/:businessObjectName/lookups', queryBase(async (req) => {
      const { businessObject } = req;
      const { lookups, scopeId } = { ...req.query, ...req.body };
      return {
        success: true,
        data: await this.getLookups({ lookups, user: { ...businessObject.user, scopeId } })
      };
    }));

    this.router.post('/:businessObjectName/list', queryBase(async (req, res) => {
      const { businessObject } = req;
      const { start, limit, sort, groupBy, include, exclude, where, filename, columns, lookups, logicalOperator, responseType, isElasticExport: isElastic, limitToSurveyed, fileName } = req.body;

      const data = await businessObject.list({ start, limit, sort, filter: where, groupBy, include, exclude, columns, logicalOperator, responseType, isElastic: Boolean(isElastic), limitToSurveyed });

      if (filename) {
        res.attachment(filename);
      }

      return {
        success: true,
        ...data,
        exportColumns: JSON.parse(columns || "[]"),
        userDateTimeFormat: businessObject.user.tags?.DateTimeFormat?.toUpperCase(),
        userDateFormat: businessObject.user.tags?.DateFormat?.toUpperCase(),
        userCurrencySymbol: businessObject.user.tags?.CurrencySymbol,
        lookups: await this.getLookups({ lookups, user: businessObject.user }),
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
        lookups: await this.getLookups({ lookups, user: businessObject.user })
      };
    }));

    this.router.put('/:businessObjectName/:id', queryBase(async (req) => {
      const { businessObject } = req;
      const { id } = req.params;
      const { relations } = req.body;

      const data = await businessObject.save({ id, relations, ...req.body });
      return { success: true, data, lookups: {} };
    }));

    this.router.delete('/:businessObjectName/:id', queryBase(async (req, res) => {
      const { businessObject } = req;
      const { id } = req.params;
      try {
        const data = await businessObject.delete({ id, ...req.body });
        res.status(200).json({ success: true, data, lookups: {} });
      } catch (error) {
        logger.error(error);
        res.status(500).json({ success: false, error: error.message || 'An unexpected error occurred.' });
      }
    }));
  }

  async getLookups({ lookups, user = {} }) {
    if (!lookups) {
      return;
    }
    const lookupTypes = lookups.trim().length ? lookups.split(',') : [];
    if (lookupTypes.length) {
      const lookupResult = {};
      for (const lookupType of lookupTypes) {
        const nameOrId = lookupType.trim();
        lookupResult[nameOrId] = await lookup.get(user, nameOrId, user.scopeId);
      }
      return lookupResult;
    }
  }
}

export default BusinessBaseObjectsRouter;

