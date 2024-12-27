import crypto from "crypto";
const fakePassword = '******';
const secretKey = process.env.CRYPTO_SECRET || 'your_secret_key'; // Replace with your actual secret key.

class User {

    static beforeSave = async ({ req }) => {
        const { PasswordHash, UserId } = req.body;
        if (PasswordHash === fakePassword) {
            if (UserId === 0) {
                throw new Error(`Password cannot be ${PasswordHash}`);
            } else {
                delete req.body.PasswordHash;
            }
        } else {
            req.body.PasswordHash = this.encryptPassword(PasswordHash);
        }
        delete req.body.ConfirmPassword;
    };

    static afterLoad = async ({ data = {} }) => {
        const { UserId } = data;
        if (UserId && UserId !== 0) {
            data.PasswordHash = fakePassword;
            data.ConfirmPassword = fakePassword;
        }
        return data;
    };

    /**
     * Encrypts the password using AES encryption with a secret key.
     * @param {string} password - The password to encrypt.
     * @returns {string} - The encrypted password.
     */
    static encryptPassword(password) {
        const cipher = crypto.createCipheriv(
            'aes-256-cbc',
            crypto.createHash('sha256').update(secretKey).digest(),
            Buffer.alloc(16, 0) // Initialization vector (IV)
        );
        let encrypted = cipher.update(password, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return encrypted;
    }

    /**
     * Decrypts the encrypted password using the same secret key.
     * @param {string} encryptedPassword - The encrypted password.
     * @returns {string} - The decrypted password.
     */
    static decryptPassword(encryptedPassword) {
        const decipher = crypto.createDecipheriv(
            'aes-256-cbc',
            crypto.createHash('sha256').update(secretKey).digest(),
            Buffer.alloc(16, 0) // Initialization vector (IV)
        );
        let decrypted = decipher.update(encryptedPassword, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }
}

export default User;
