export default {
    dateTimeFields: ['date', 'datetime', 'dateTime', 'dateTimeLocal'],
    dateTimeExportFormat: ' hh:mm:ss A',
    dateTimeCSVExportFormat: '-hh:mm:ss A',
    dateTimeISOFormat: "YYYY-MM-DDTHH:mm:ss",
    filterDateFormat: "YYYY-MM-DD HH:mm:ss",
    fullDateFormat: "YYYYMMDDHHmmssSSS",
    dateTimeExcelExportFormat: ' hh:mm:ss AM/PM',
    dateTimeExcelRowExportFormat: ' hh:mm:ss A',
    ENTRA_APP_STAGES: {
        SIGN_IN: 'sign_in',
        PASSWORD_RESET: 'password_reset',
        EDIT_PROFILE: 'edit_profile',
        ACQUIRE_TOKEN: 'acquire_token'
    },
    authMethods: {
        basicAuth: 'basicAuth',
        entraIdAuth: 'entraIdAuth'
    },
    PermissionType: {
        Module: 0,
        Add: 1,
        Edit: 2,
        Delete: 3,
        Export: 4,
        Tag: 5
    },
    elasticHitsMaxSize: 10000,
    expectedRecordsets: 4
}