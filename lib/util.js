import { promisify } from 'util';
import got from 'got'
import stream from 'stream';
import fs from 'fs';
import FormData from 'form-data';
import { Buffer } from 'buffer';

const macRegex = /([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/

const pipeline = promisify(stream.pipeline);
const dataModes = {
    json: 1,
    formAsJson: "input",
    formIndividualValues: 3,
    formLegenidValues: 4,
    asFile: "file"
};

export default {
    macRegex,
    dataModes,
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
    request: async function ({ uploadUrl, formMode, filename = "file", data, contentType = 'application/json', tokenUrl = null, token = null, tokenParameters = null }) {
        for (let trial = 0; trial < 2; trial++) {
            if (token === null && tokenUrl) {
                token = await this.getToken(tokenUrl, tokenParameters);
            }
            const headers = {};
            if (token) {
                headers.Authorization = token ? `Bearer ${this.token}` : "Basic " + Buffer.from(`pradeep.kumar@in.coolrgroup.com:admin`).toString("base64");
                //headers.ContentType = 'application/json';
                headers.Accept = '*/*';
            }
            let body;
            switch (formMode) {
                case dataModes.formIndividualValues:
                    body = new FormData();
                    {
                        const keys = data.Legenid;
                        const values = data.Values[0];
                        for (const [index, key] of keys.entries()) {
                            body.append(key, values[index]);
                        }
                    }
                    break;
                case dataModes.formAsJson:
                    body = new FormData();
                    body.append(dataModes.formAsJson, JSON.stringify(data));
                    break;
                case dataModes.asFile:
                    body = new FormData();
                    {
                        const blob = data ? Buffer.from(JSON.stringify(data)) : fs.createReadStream(filename);
                        body.append(dataModes.asFile, blob, { filename: filename, contentType: contentType });
                        if (data) {
                            for (var key of Object.keys(data)) {
                                body.append(key, data[key]);
                            }
                        }
                    }
            }
            try {
                const result = await got.post(uploadUrl, {
                    body,
                    json: body ? undefined : data,
                    headers
                });

                console.error({ status: result.statusCode, body: result.body });
                return result;
            } catch (error) {
                if (error.response) {
                    if (error.response.statusCode === 403) {
                        console.error('Token expired.. will retry');
                    } else {
                        console.error({ status: error.response.statusCode, body: error.response.body });
                        break;
                    }
                } else {
                    console.error(error);
                    break;
                }
            }
        }
    },
    getToken: async function (tokenUrl, tokenParameters) {
        try {
            const result = await got.post(tokenUrl, {
                form: tokenParameters
            }).json();
            return result.access_token;
        } catch (error) {
            console.error(error.response.body);
            return null;
        }
    },
    buildFormData: function (formData, data, parentKey) {
        if (data && typeof data === 'object' && !(data instanceof Date) && !(data instanceof Buffer)) {
            Object.keys(data).forEach(key => {
                this.buildFormData(formData, data[key], parentKey ? `${parentKey}[${key}]` : key);
            });
        } else {
            const value = data == null ? '' : data;
            formData.append(parentKey, value);
        }
    },

    jsonToFormData: function (data) {
        const formData = new FormData();
        this.buildFormData(formData, data);
        return formData;
    }
};