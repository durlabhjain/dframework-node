import fs from 'fs';
import logger from '../logger.js';

const GENERIC_DUPLICATE_MESSAGE = 'A record with the same value already exists.';
// Index, unique-key and primary-key names must never reach an end user.
const DB_OBJECT_NAME = /\b(?:IX|UQ|PK)_\w+/;
const CAPTURE_PLACEHOLDER = /\$\{\d+\}/;
const DUPLICATE_LABEL_TEMPLATE = (label) => `${label} already exists. Please use a different name.`;

// The two SQL Server duplicate-key forms: error 2601 names the index, 2627 names the constraint.
const DUPLICATE_KEY_OBJECT = /(?:duplicate key row in object .+? with (?:unique )?index|violation of (?:unique key|primary key) constraint) '([^']+)'/i;

class ErrorMapper {

    file = "./sql-error-mappings.json";

    mappings = null;

    /**
     * Message substituted whenever the mapped name cannot be resolved to a label.
     */
    genericMessage = GENERIC_DUPLICATE_MESSAGE;

    constructor({ file, genericMessage } = {}) {
        if (file) {
            this.file = file;
        }
        if (genericMessage) {
            this.genericMessage = genericMessage;
        }
    }

    getMappings() {
        if (!this.mappings) {
            // An app that declares its messages per business object has no mappings file.
            // Treat an unreadable file as "no file-based mappings" rather than failing the save.
            try {
                const mappingData = JSON.parse(fs.readFileSync(this.file));
                for (const entry of mappingData) {
                    entry.pattern = new RegExp(entry.pattern);
                }
                this.mappings = mappingData;
            } catch (err) {
                if (err.code !== 'ENOENT') {
                    logger.warn({ err, file: this.file }, 'Could not read SQL error mappings');
                }
                this.mappings = [];
            }
        }
        return this.mappings;
    }

    /**
     * Translates a database error message into a user-facing one.
     *
     * A mapping entry whose `description` interpolates a captured group (`${1}`) only has safe
     * output for the names listed in its `mappings`. Interpolating anything else would put a raw
     * index or constraint name in front of a user, so an unrecognized name falls back to
     * `genericMessage` instead. Entries with a constant description keep it as written.
     *
     * @param {string} error - The raw database error message.
     * @returns {string} The mapped message, or the input unchanged when nothing matches and it
     *                   carries no database object name.
     */
    map(error) {
        if (typeof error !== 'string') {
            return error;
        }
        const mappings = this.getMappings();
        const mappingEntry = mappings.find(m => m.pattern.test(error));
        if (mappingEntry) {
            const exResult = mappingEntry.pattern.exec(error);
            const { description } = mappingEntry;
            const replacement = (mappingEntry.mappings || {})[exResult[1]];
            if (CAPTURE_PLACEHOLDER.test(description) && !replacement) {
                return this.genericMessage;
            }
            return description.replace(/\$\{(\d+)\}/g, () => replacement);
        }
        // Also catches a message that already picked up a database object name elsewhere.
        if (DB_OBJECT_NAME.test(error)) {
            return this.genericMessage;
        }
        return error;
    }
}

const sqlErrorMapper = new ErrorMapper({ file: "./sql-error-mappings.json" });

/**
 * Returns the index or constraint name a duplicate-key error names, or null.
 *
 * @param {string} error - The raw database error message.
 * @returns {string|null}
 */
function getDuplicateKeyObject(error) {
    if (typeof error !== 'string') {
        return null;
    }
    return DUPLICATE_KEY_OBJECT.exec(error)?.[1] ?? null;
}

/**
 * Translates a database error using the owning object's own `duplicateKeyMessages`, keyed by the
 * index or constraint name the error names. Declaring them beside the rest of a business object's
 * configuration keeps the index-to-label relationship where the schema relationship already lives,
 * instead of in a separate global file.
 *
 * Each value is either a field label, used as "<label> already exists. Please use a different
 * name.", or `{ message }` to supply the whole sentence.
 *
 * Anything not declared there falls through to the file-based `sqlErrorMapper`, which also supplies
 * the generic fallback, so a caller with no configuration still never leaks a database object name.
 *
 * @param {string} error - The raw database error message.
 * @param {Object} [options]
 * @param {Object} [options.duplicateKeyMessages] - Map of index/constraint name to label or `{ message }`.
 * @returns {string} The user-facing message.
 */
function mapDatabaseError(error, { duplicateKeyMessages } = {}) {
    if (typeof error !== 'string') {
        return error;
    }
    const objectName = getDuplicateKeyObject(error);
    const configured = objectName ? duplicateKeyMessages?.[objectName] : undefined;
    if (configured) {
        return typeof configured === 'string' ? DUPLICATE_LABEL_TEMPLATE(configured) : configured.message;
    }
    return sqlErrorMapper.map(error);
}

export {
    sqlErrorMapper,
    ErrorMapper,
    mapDatabaseError,
    getDuplicateKeyObject
}
