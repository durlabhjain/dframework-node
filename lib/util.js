import { promisify } from 'util';
import got from 'got'
import stream from 'stream';
import fs from 'fs';
import prompt from 'prompt';

const macRegex = /([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/

const pipeline = promisify(stream.pipeline);

const defaultTemplate = /\${((\w+)\.)?(\w+)}/gm;

export default {
    macRegex,

    dateFormat: 'M-D-Y',

    dateTimeFormat: 'M-D-Y HH:mm:ss',

    SECOND: 1000,

    MINUTE: 60 * 1000,

    HOUR: 60 * 60 * 1000,

    DAY: 24 * 60 * 60 * 1000,

    formatDate: function (date, dateFormat) {
        dateFormat = dateFormat || this.dateFormat;
        if (!date) return date;
        if (typeof date === 'string' && date.length === 17) {
            date = this.parseDate(date);
        }
        if (!date.getFullYear) { return date; }
        return dateFormat.replace('Y', date.getFullYear())
            .replace('y', date.getFullYear().toString().substr(2))
            .replace('M', (date.getMonth() + 1).toString().padStart(2, '0'))
            .replace('D', date.getDate().toString().padStart(2, '0'))
            .replace('HH', date.getHours().toString().padStart(2, '0'))
            .replace('mm', date.getMinutes().toString().padStart(2, '0'))
            .replace('ss', date.getSeconds().toString().padStart(2, '0'))
    },

    formatDateTime: function (date, dateFormat) {
        return this.formatDate(date, dateFormat || this.dateTimeFormat);
    },

    isMacAddress: function (value) {
        return typeof value === 'string' && macRegex.test(value);
    },

    parseDate: function (value) {
        //20171025121944933
        if (value && value.length > 10) {
            return new Date(value.substr(0, 4), value.substr(4, 2) - 1, value.substr(6, 2), value.substr(8, 2), value.substr(10, 2), value.substr(12, 2), value.substr(14, 3));
        }
        return value;
    },

    join: function ({ left, right, join, columns }) {
        const lookup = {};
        let key = join[1];
        for (const entry of right) {
            if (entry.hasOwnProperty(key)) {
                const keyValue = entry[key];
                if (keyValue !== undefined && keyValue !== null) {
                    lookup[keyValue] = entry;
                }
            }
        }
        key = join[0];
        for (const row of left) {
            let lookupEntry = {};
            if (row.hasOwnProperty(key)) {
                const keyValue = row[key];
                lookupEntry = lookup[keyValue] || {};
            }
            for (const column of columns) {
                row[column] = lookupEntry[column];
            }
        }
    },

    /**
     * Return a default value if date is not a valid date
     * @param date Date value to be evaluated
     * @param defaultDate Date optional - value to be assigned if date is invalid/ empty. Defaultst to 1/1/2000
     * @returns date a valid date
     */
    safeDate: function (date, defaultDate = new Date(2000, 0, 1)) {
        if (date === null || typeof date.getMonth !== 'function') {
            return defaultDate;
        }
        return date;
    },

    /**
     * Returns the minimum value in the array
     * @param arr Array elements
     * @param min Any default minimum value
     * @returns Minimum value in the array
     */
    min: function (arr, min = Infinity) {
        var len = arr.length;
        while (len--) {
            if (arr[len] < min) {
                min = arr[len];
            }
        }
        return min;
    },

    /**
     * Returns the maximum value in the array
     * @param arr Array elements
     * @param min Any default maximum value
     * @returns Maximum value in the array
     */
    max: function (arr, max = -Infinity) {
        var len = arr.length
        while (len--) {
            if (arr[len] > max) {
                max = arr[len];
            }
        }
        return max;
    },

    /**
     * Downloads a file from a url
     * @param {String} url
     * @param {Object} options
     * @param {any} options.dest - string/ function({ filename, response }) - destination file path or function to return a destination file path
     * @returns 
     */
    download: function (url, { dest } = {}) {
        return new Promise((resolve, reject) => {
            got.stream(url)
                .on('response', async response => {
                    if (response.statusCode !== 200) {
                        return reject(new Error('Invalid status'), response);
                    }
                    let filename = response.headers['content-disposition'].split('filename=')[1];
                    if (filename) {
                        filename = filename.replace(/\"/g, '');
                    }
                    if (typeof dest === 'function') {
                        filename = dest({ filename, response });
                    } else if (typeof dest === 'string') {
                        filename = dest;
                    }
                    if (!filename) {
                        return reject(new Error('No filename'), response);
                    }
                    const outFile = fs.createWriteStream(filename);
                    await pipeline(
                        response,
                        outFile
                    );
                    resolve();
                })
                .resume();
        });
    },

    prompt,

    confirm: async function (options) {
        if (typeof options === 'string') {
            options = {
                description: options
            };
        }
        options = {
            description: 'Are you sure?',
            pattern: /^[yn]$/,
            required: true,
            message: 'Please enter y or n',
            ...options
        };
        const { confirm } = await prompt.get({
            properties: {
                confirm: options
            }
        });
        return confirm === 'y';
    },

    /**
     * @description Replaces the given tags in the given source with the given values.
     * @param {string} source The source to replace the tags in.
     * @param {object} values The values to replace the tags with.
     * @param {object} options template - Regex to use for matching tags, keepMissingTags - Whether to keep tags that are not replaced.
     * @returns {string} The source with the tags replaced.
     * @example
     * // Replaces all tags in the given source with the given values.
     * console.log(template("${firstName} ${lastName}", { firstName: "John", lastName: "Doe" }));
     * // -> "John Doe"
     * // Two level tags are supported.
     * console.log(template("${user.firstName} ${user.lastName}", { user: { firstName: "John", lastName: "Doe" } }));
     * // -> "John Doe"
     **/
    replaceTags: function (source, tags, { template = defaultTemplate, keepMissingTags = false } = {}) {
        if (!source || !tags) {
            return source;
        }

        return source.replace(template, function (match, g1, g2, g3) {
            const container = g2 ? tags[g2] || {} : tags;
            return container[g3] === undefined ? (keepMissingTags ? match : "") : container[g3];
        });
    }
};