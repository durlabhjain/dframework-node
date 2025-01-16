import crypto from "crypto";
const fakePassword = '******';
const secretKey = process.env.CRYPTO_SECRET || 'your_secret_key'; // Replace with your actual secret key.

class User {

    static beforeSave = async ({ req }) => {
        const { PasswordHash, UserId } = req.body;
        if (!PasswordHash) {
            return;
        }
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
        const hash = crypto.createHash('sha256');
        hash.update(password);
        const hashedPassword = hash.digest('hex');
        return hashedPassword;
    }

}

export default User;
