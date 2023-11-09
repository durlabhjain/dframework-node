const generateReport = function (report, config) {
    return async function (req, res, next) {
        try {
            const { responseType } = { ...req.query, ...req.body };
            const result = await report(req, res);
            if (result) {
                if (result.success) {
                    return res.transform(result, { responseType, fileName: result.fileName, ...config });
                }
            }
            next();
        } catch (err) {
            next(err);
        }
    };
};

export default generateReport;