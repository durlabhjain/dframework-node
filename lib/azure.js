
import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';

class Azure {

    logger = console;

    constructor(options) {
        Object.assign(this, options);
        const { account, accountKey } = options;
        const azureCredential = accountKey ? new StorageSharedKeyCredential(account, accountKey) : new DefaultAzureCredential();

        this.blobServiceClient = new BlobServiceClient(
            `https://${account}.blob.core.windows.net`,
            azureCredential
        );
    }

    getContainer(container) {
        if (typeof container === 'string') {
            return this.blobServiceClient.getContainerClient(container);
        }
        return container;
    }

    async moveBlobs({ sourceContainer, targetContainer, minSize = 0 }) {
        sourceContainer = this.getContainer(sourceContainer);
        targetContainer = this.getContainer(targetContainer);

        const needMove = !!targetContainer;

        let i = 1;
        const blobs = sourceContainer.listBlobsFlat();
        const toCopy = [];
        for await (const blob of blobs) {
            logger.debug({ 
                blobIndex: i++, 
                name: blob.name, 
                createdOn: blob.properties.createdOn, 
                contentLength: blob.properties.contentLength 
            }, 'Processing blob');
            if (minSize && blob.properties.contentLength > minSize) {
                if (needMove) {
                    const sourceBlob = sourceContainer.getBlobClient(blob.name);
                    const desBlob = targetContainer.getBlobClient(blob.name)
                    desBlob.deleteIfExists();
                    const response = await desBlob.beginCopyFromURL(sourceBlob.url);
                    const result = (await response.pollUntilDone())
                    logger.debug({ 
                        status: result._response.status, 
                        copyStatus: result.copyStatus 
                    }, 'Blob copy result');
                    if (result.copyStatus === "success") {
                        logger.debug({ blobName: blob.name }, 'Deleting old blob');
                        await sourceBlob.delete();
                    }
                }
                toCopy.push(blob);
            }
        }
        logger.info({ count: toCopy.length }, 'Blobs to move');
    }

    async listContainers({ listOptions = { prefix: 'logs' }, filter } = {}) {
        const { blobServiceClient, logger } = this;
        const items = [];
        let i = 1;
        for await (const container of blobServiceClient.listContainers(listOptions)) {
            if (filter) {
                const result = await Promise.resolve(filter(container));
                if (result === false) {
                    continue;
                }
            }
            items.push(container);
            logger.info(`Container ${i++}: ${container.name}`);
        }
        return items;
    }

    async listBlobs({ container }) {
        const { logger } = this;
        container = this.getContainer(container);
        let i = 1;
        const blobs = container.listBlobsFlat();
        const items = [];
        for await (const blob of blobs) {
            items.push(blob);
            logger.info(`Blob ${i++}: ${blob.name} ${blob.properties.createdOn} ${blob.properties.contentLength}`);
        }
        return items;
    }
}

export default Azure;