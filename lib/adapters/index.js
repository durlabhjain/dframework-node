import RequestAdapter from "./request-adapter.js";
import AxiosAdapter from "./axios-adapter.js";
import GotAdapter from "./got-adapter.js";
import ElasticSearchAdapter from "./elasticsearch-adapter.js";
import OpenSearchAdapter from "./opensearch-adapter.js";

export default {
    request: {
        Base: RequestAdapter,
        Got: GotAdapter,
        Axios: AxiosAdapter
    },
    search: {
        Elastic: ElasticSearchAdapter,
        OpenSearch: OpenSearchAdapter
    }
};