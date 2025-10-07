
import multer from "multer";
import path from "path";
import fs from 'fs';
import logger from '../logger.js';
import { enums } from '../../index.js';

const filePath = process.env.FILE_PATH || 'uploads';
if (!fs.existsSync(filePath)) {
    fs.mkdirSync(filePath, { recursive: true });
}
export const attachmentPath = path.join("./", filePath);

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, attachmentPath);
    },
    filename: (req, file, cb) => {
        // Check if the request URL matches '/auditsurvey/saveSurveyAnswer'
        if (req.originalUrl === enums.uploadCaptureUrl) {
            // Use the original filename
            cb(null, file.originalname);
        } else {
            // Otherwise, create a unique filename
            const uniqueSuffix = Date.now() + Math.round(Math.random() * 100);
            cb(null, uniqueSuffix + path.extname(file.originalname));
        }
    }
});

export const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        cb(null, true);
    }
});

export const removeTempFile = async (filePath) => {
    fs.unlink(filePath, (error) => {
        if (error) {
            logger.error({ error }, 'Error deleting the file:');
            return;
        }
    });
}

export const readFiles = (files) => {
    try {
        const formFiles = [];
        for (const file of files) {
            if (fs.existsSync(file.path)) {
                const fileStream = fs.createReadStream(file.path);
                fileStream.on('error', (error) => {
                    logger.error({ error }, `File stream error for attachments ${file.path}: `);
                });
                formFiles.push(fileStream);
            } else {
                logger.error(new Error(`Error in reading file - ${file.path}`));
            }
        }
        return formFiles;
    } catch (error) {
        logger.error({ error }, "Error in 'appendFilesToFormData':");
    }
}