import BusinessBase from "./business-base.mjs";

const permissionFields = [
    'Permission1', 'Permission2', 'Permission3', 'Permission4',
    'Permission5', 'Permission6', 'Permission7', 'Permission8',
    'Permission9', 'Permission10'
];

class RoleModule {
    // Method to handle any processing before saving the RoleModule data
    static beforeSave = async ({ req }) => {
        const { RoleId, ModuleId, RoleModuleId } = req.body;

        // If the RoleModuleId is 0, check for mandatory fields (RoleId, ModuleId, etc.)
        if (RoleModuleId === 0) {
            if (!RoleId || !ModuleId) {
                throw new Error('RoleId and ModuleId are required.');
            }
        }

        // Create a permissions binary string from the individual Permission fields
        const permissionsBinary = permissionFields
            .map(field => (req.body[field] === '1' || req.body[field] === true) ? '1' : '0') // Check if field is '1' or '0'
            .join(''); // Join them into a single string

        // Update the Permissions field with the combined binary string
        req.body.Permissions = permissionsBinary;
        delete req.body.Name;

        // Remove the individual Permission fields from the request body
        permissionFields.forEach(field => delete req.body[field]);
        return req
    };


    // Method to handle any processing after loading RoleModule data
    static afterLoad = async ({ data = {} }) => {
        // If Permissions exist, transform related fields

        // Convert Permission fields from 1/0 to true/false
        permissionFields.forEach(field => {
            if (field in data) {
                data[field] = data[field] === 1; // Convert to boolean
            }
        });

        return data;
    };
}

export { RoleModule };

export default RoleModule;
