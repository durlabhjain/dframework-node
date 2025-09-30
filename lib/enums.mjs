export default {
    dateTimeFields: ['date', 'datetime', 'dateTime', 'dateTimeLocal'],
    dateTimeExportFormat: ' hh:mm:ss A',
    dateTimeCSVExportFormat: '-hh:mm:ss A',
    ENTRA_APP_STAGES: {
        SIGN_IN: 'sign_in',
        PASSWORD_RESET: 'password_reset',
        EDIT_PROFILE: 'edit_profile',
        ACQUIRE_TOKEN: 'acquire_token'
    },
    authMethods: {
        basicAuth: 'basicAuth',
        entraIdAuth: 'entraIdAuth'
    }
}