import fs from 'fs';
import logger from '../logger.js';

const GENERIC_DUPLICATE_MESSAGE = 'A record with the same value already exists.';
// Index, unique-key and primary-key names must never reach an end user.
const DB_OBJECT_NAME = /\b(?:IX|UQ|PK)_\w+/;
const VALID_OBJECT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CAPTURE_PLACEHOLDER = /\$\{\d+\}/;
const DUPLICATE_LABEL_TEMPLATE = (label) => `${label} already exists. Please use a different name.`;

// The two SQL Server duplicate-key forms: error 2601 names the index, 2627 names the constraint.
const DUPLICATE_KEY_OBJECT = /(?:duplicate key row in object .+? with (?:unique )?index|violation of (?:unique key|primary key) constraint) '([^']+)'/i;

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

const toEntry = (entry) => ({
    ...entry,
    pattern: entry.pattern instanceof RegExp ? entry.pattern : new RegExp(entry.pattern),
    mappings: entry.mappings || {}
});

/**
 * Translates raw database errors into user-facing messages. One instance (`sqlErrorMapper`) is shared by
 * every business object; each application registers its own messages on it, so nothing is hard-coded here.
 *
 * Resolution order for a message:
 * 1. Duplicate-key messages passed by the caller (a business object's own `duplicateKeyMessages`).
 * 2. Duplicate-key messages registered app-wide with `register({ duplicateKeyMessages })`.
 * 3. Regex mappings: registered with `register({ mappings })`, then the optional mappings file.
 * 4. Any other duplicate-key error, or a message carrying an IX_/UQ_/PK_ name, becomes `genericMessage`.
 * Anything else is returned unchanged.
 *
 * A duplicate-key message is a field label, used as "<label> already exists. Please use a different
 * name.", or `{ message }` for the whole sentence. A regex mapping is `{ pattern, description, mappings }`
 * where `${1}` in description is replaced by `mappings[capture]`; an unmapped capture yields
 * `genericMessage`, so a raw database object name is never interpolated.
 */
class ErrorMapper {

    file = "./sql-error-mappings.json";

    /** Resolved regex mappings (registered, then file). Rebuilt after register(). */
    mappings = null;

    genericMessage = GENERIC_DUPLICATE_MESSAGE;

    duplicateKeyMessages = {};

    #registeredMappings = [];

    /**
     * @param {Object} [options]
     * @param {string|false} [options.file] - JSON mappings file; optional, a missing file is ignored. `false` disables it.
     * @param {Array<Object>} [options.mappings] - Regex mappings, see register().
     * @param {Object} [options.duplicateKeyMessages] - App-wide index/constraint name to label or `{ message }`.
     * @param {string} [options.genericMessage] - Message for unrecognized duplicate keys.
     */
    constructor({ file, ...registration } = {}) {
        if (file !== undefined) {
            this.file = file;
        }
        this.register(registration);
    }

    /**
     * Adds application messages. Safe to call more than once; later registrations win for the same name.
     *
     * @param {Object} [options]
     * @param {Object} [options.duplicateKeyMessages] - Index/constraint name to label or `{ message }`.
     * @param {Array<Object>} [options.mappings] - `{ pattern, description, mappings }` regex entries.
     * @param {string} [options.genericMessage] - Replaces the generic duplicate message.
     * @returns {ErrorMapper} this, for chaining.
     */
    register({ duplicateKeyMessages = {}, mappings = [], genericMessage } = {}) {
        for (const [name, configured] of Object.entries(duplicateKeyMessages)) {
            if (!VALID_OBJECT_NAME.test(name)) {
                throw new Error(`Invalid duplicateKeyMessages key: ${name}`);
            }
            this.duplicateKeyMessages[name] = configured;
        }
        this.#registeredMappings.push(...mappings.map(toEntry));
        this.mappings = null;
        if (genericMessage) {
            this.genericMessage = genericMessage;
        }
        return this;
    }

    getMappings() {
        if (!this.mappings) {
            this.mappings = [...this.#registeredMappings, ...this.#readFile()];
        }
        return this.mappings;
    }

    #readFile() {
        if (!this.file) {
            return [];
        }
        try {
            return JSON.parse(fs.readFileSync(this.file)).map(toEntry);
        } catch (err) {
            // Apps that register their messages in code have no mappings file.
            if (err.code !== 'ENOENT') {
                logger.warn({ err, file: this.file }, 'Could not read SQL error mappings');
            }
            return [];
        }
    }

    /**
     * Translates a database error message into a user-facing one.
     *
     * @param {string} error - The raw database error message.
     * @param {Object} [options]
     * @param {Object} [options.duplicateKeyMessages] - Caller-specific messages, checked first.
     * @returns {string} The mapped message, or the input unchanged when nothing applies.
     */
    map(error, { duplicateKeyMessages } = {}) {
        if (typeof error !== 'string') {
            return error;
        }
        const objectName = getDuplicateKeyObject(error);
        const configured = objectName ? (duplicateKeyMessages?.[objectName] ?? this.duplicateKeyMessages[objectName]) : undefined;
        if (configured) {
            return typeof configured === 'string' ? DUPLICATE_LABEL_TEMPLATE(configured) : configured.message;
        }
        const mappingEntry = this.getMappings().find(m => m.pattern.test(error));
        if (mappingEntry) {
            const { description } = mappingEntry;
            if (!CAPTURE_PLACEHOLDER.test(description)) {
                return description;
            }
            const replacement = mappingEntry.mappings[mappingEntry.pattern.exec(error)?.[1]];
            return replacement ? description.replace(/\$\{(\d+)\}/g, () => replacement) : this.genericMessage;
        }
        // Also catches a message that already picked up a database object name elsewhere.
        if (objectName || DB_OBJECT_NAME.test(error)) {
            return this.genericMessage;
        }
        return error;
    }
}

const sqlErrorMapper = new ErrorMapper();

/**
 * Translates a database error with the shared mapper, checking `duplicateKeyMessages` (typically the
 * owning business object's) first.
 *
 * @param {string} error - The raw database error message.
 * @param {Object} [options]
 * @param {Object} [options.duplicateKeyMessages] - Map of index/constraint name to label or `{ message }`.
 * @returns {string} The user-facing message.
 */
function mapDatabaseError(error, { duplicateKeyMessages } = {}) {
    return sqlErrorMapper.map(error, { duplicateKeyMessages });
}

export {
    sqlErrorMapper,
    ErrorMapper,
    mapDatabaseError,
    getDuplicateKeyObject,
    GENERIC_DUPLICATE_MESSAGE
}
