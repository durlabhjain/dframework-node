import mssql from 'mssql';
import util from './util.js';

const { sqlParameterLength } = util;

const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

const STRING_LENGTH_TIERS = [10, 20, 50, 100, 200, 500, 1000, 2000, 4000, 8000];
const SCALE_TIERS = [2, 4, 6, 8, 10, 17];
const PRECISION_TIERS = [9, 18, 28, 38];

const asciiRegex = /^[\x00-\x7F]*$/;

/**
 * Returns true when every character in the string is within the ASCII range,
 * meaning it can round-trip through VARCHAR without data loss.
 */
const isAsciiString = (value) => asciiRegex.test(value);

/**
 * Rounds a required length up to the nearest fixed tier (bounded by maxLength),
 * so that values of similar-but-not-identical length still share one declared
 * parameter length/plan-cache entry instead of a bespoke length per call.
 */
const bucketLength = (length, maxLength) => {
    if (!Number.isFinite(length) || length <= 0) {
        return Math.min(1, maxLength);
    }
    for (const tier of STRING_LENGTH_TIERS) {
        if (tier >= maxLength) {
            break;
        }
        if (length <= tier) {
            return tier;
        }
    }
    return length <= maxLength ? maxLength : mssql.MAX;
};

/**
 * Computes the minimal integer-digit and fractional-digit (scale) counts
 * needed to represent every value in `values` without truncation.
 */
const getRequiredDecimalDigits = (values) => {
    let maxIntegerDigits = 1;
    let maxScale = 0;
    for (const n of values) {
        if (!Number.isFinite(n)) {
            continue;
        }
        const abs = Math.abs(n);
        let str = abs.toString();
        if (str.includes('e') || str.includes('E')) {
            str = abs.toFixed(15).replace(/0+$/, '').replace(/\.$/, '');
        }
        const [intPart, fracPart = ''] = str.split('.');
        const trimmedIntPart = intPart.replace(/^0+/, '') || '0';
        maxIntegerDigits = Math.max(maxIntegerDigits, trimmedIntPart.length);
        maxScale = Math.max(maxScale, fracPart.length);
    }
    return { maxIntegerDigits, maxScale };
};

/**
 * Derives a DECIMAL(precision, scale) sized to hold every value in `values`,
 * rounded up to a small set of fixed precision/scale tiers. Bucketing (rather
 * than emitting the exact digits needed per call) keeps repeated calls with
 * differently-shaped values on the same cached query plan.
 */
const getDecimalSqlType = (values) => {
    const list = Array.isArray(values) ? values : [values];
    const { maxIntegerDigits, maxScale } = getRequiredDecimalDigits(list);

    const maxScaleTier = sqlParameterLength.decimal_scale;
    let scale = SCALE_TIERS.find((tier) => tier <= maxScaleTier && tier >= maxScale);
    if (scale === undefined) {
        scale = Math.min(maxScale, maxScaleTier);
    }

    const maxPrecisionTier = sqlParameterLength.decimal_precision;
    const requiredPrecision = maxIntegerDigits + scale;
    let precision = PRECISION_TIERS.find((tier) => tier <= maxPrecisionTier && tier >= requiredPrecision);
    if (precision === undefined) {
        precision = Math.min(Math.max(requiredPrecision, 1), maxPrecisionTier);
    }
    if (scale > precision) {
        scale = precision;
    }
    return mssql.Decimal(precision, scale);
};

/**
 * Picks VarChar vs NVarChar based on ASCII content (avoids implicit conversion
 * of VARCHAR-indexed columns to NVARCHAR), and buckets the length so values of
 * similar size reuse the same declared parameter type/cached plan.
 */
const getStringSqlType = (value) => {
    const ascii = isAsciiString(value);
    const maxLength = ascii ? sqlParameterLength.varchar : sqlParameterLength.nvarchar;
    const length = bucketLength(value.length, maxLength);
    return ascii ? mssql.VarChar(length) : mssql.NVarChar(length);
};

/**
 * Picks Int vs BigInt for a whole-number value/range, mirroring SQL Server's
 * own INT bounds. TinyInt/SmallInt are intentionally not chosen here for a
 * single scalar value: narrowing by magnitude per-call would vary the
 * parameter type across calls to the same query and fragment the plan cache.
 * Batch callers (see inferBatchSqlType) can safely narrow further since they
 * scan the whole set once per call, not once per value.
 */
const getIntegerSqlType = (min, max = min) => {
    if (min < INT32_MIN || max > INT32_MAX) {
        return mssql.BigInt;
    }
    return mssql.Int;
};

/**
 * Narrows an integer batch to TinyInt/SmallInt/Int/BigInt based on the true
 * min/max of the whole batch. Safe to narrow here (unlike the single-value
 * case) because the decision is made once per call from the full value set.
 */
const getBatchIntegerSqlType = (min, max) => {
    if (min >= 0 && max <= 255) {
        return mssql.TinyInt;
    }
    if (min >= -32768 && max <= 32767) {
        return mssql.SmallInt;
    }
    return getIntegerSqlType(min, max);
};

/**
 * Infers the mssql SQL type for a single JS value. Used wherever a caller
 * does not supply an explicit sqlType, replacing the mssql driver's own
 * default inference (which maps every string to NVARCHAR(MAX) and every
 * fractional number to FLOAT).
 */
const inferSqlType = (value) => {
    if (value === null || value === undefined) {
        // No type information can be derived from a bare null; keep the
        // historical NVarChar fallback used by the mssql driver itself.
        return mssql.NVarChar;
    }
    if (typeof value === 'boolean') {
        return mssql.Bit;
    }
    if (value instanceof Date) {
        return mssql.DateTime2;
    }
    if (Buffer.isBuffer(value)) {
        return mssql.VarBinary(bucketLength(value.length, sqlParameterLength.varchar));
    }
    if (typeof value === 'bigint') {
        return getIntegerSqlType(value < 0n ? Number(value) : 0, value > 0n ? Number(value) : 0);
    }
    if (typeof value === 'number') {
        if (Number.isInteger(value)) {
            return getIntegerSqlType(value);
        }
        return getDecimalSqlType(value);
    }
    if (typeof value === 'string') {
        return getStringSqlType(value);
    }
    return mssql.NVarChar;
};

/**
 * Infers a single shared mssql SQL type for a batch of values (array/TVP
 * column). Scans every value (not just the first) so a later row with a
 * fractional number, longer string, or non-ASCII content is never truncated
 * by a type chosen from an earlier row.
 */
const inferBatchSqlType = (values) => {
    const list = Array.isArray(values) ? values : [values];
    const nonNull = list.filter((value) => value !== null && value !== undefined);
    if (nonNull.length === 0) {
        return mssql.NVarChar;
    }

    if (nonNull.every((value) => typeof value === 'boolean')) {
        return mssql.Bit;
    }
    if (nonNull.every((value) => value instanceof Date)) {
        return mssql.DateTime2;
    }
    if (nonNull.every((value) => Buffer.isBuffer(value))) {
        const maxLength = nonNull.reduce((max, buf) => Math.max(max, buf.length), 0);
        return mssql.VarBinary(bucketLength(maxLength, sqlParameterLength.varchar));
    }
    if (nonNull.every((value) => typeof value === 'number' || typeof value === 'bigint')) {
        const numeric = nonNull.map(Number);
        if (numeric.every((value) => Number.isInteger(value))) {
            return getBatchIntegerSqlType(Math.min(...numeric), Math.max(...numeric));
        }
        return getDecimalSqlType(numeric);
    }
    if (nonNull.every((value) => typeof value === 'string')) {
        const allAscii = nonNull.every(isAsciiString);
        const maxLength = nonNull.reduce((max, str) => Math.max(max, str.length), 0);
        const bucketMax = allAscii ? sqlParameterLength.varchar : sqlParameterLength.nvarchar;
        const length = bucketLength(maxLength, bucketMax);
        return allAscii ? mssql.VarChar(length) : mssql.NVarChar(length);
    }

    // Mixed/unrecognized shapes: fall back to the safe untyped default.
    return mssql.NVarChar;
};

export {
    isAsciiString,
    getDecimalSqlType,
    getStringSqlType,
    inferSqlType,
    inferBatchSqlType
};
