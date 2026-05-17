
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  createHash,
} from 'crypto'

const ALGORITHM  = 'aes-256-gcm'
const IV_LENGTH  = 16
const TAG_LENGTH = 16
const SALT_LEN   = 32

function getBackupSecret(): string {
  const secret = process.env.BACKUP_ENCRYPTION_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('BACKUP_ENCRYPTION_SECRET env var is missing or too short.')
  }
  return secret
}

/**
 * Encrypts a Buffer using AES-256-GCM.
 * Output format: salt(32) || iv(16) || authTag(16) || ciphertext
 */
export async function encryptBackupData(plaintext: Buffer): Promise<Buffer> {
  const secret = getBackupSecret()
  const salt   = randomBytes(SALT_LEN)
  const iv     = randomBytes(IV_LENGTH)
  const key    = scryptSync(secret, salt, 32) as Buffer

  const cipher    = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authTag   = cipher.getAuthTag()

  return Buffer.concat([salt, iv, authTag, encrypted])
}

/**
 * Decrypts a Buffer produced by encryptBackupData().
 */
export async function decryptBackupData(ciphertext: Buffer): Promise<Buffer> {
  const secret = getBackupSecret()

  if (ciphertext.length < SALT_LEN + IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error('Ciphertext is too short — file may be corrupted.')
  }

  const salt      = ciphertext.subarray(0, SALT_LEN)
  const iv        = ciphertext.subarray(SALT_LEN, SALT_LEN + IV_LENGTH)
  const authTag   = ciphertext.subarray(SALT_LEN + IV_LENGTH, SALT_LEN + IV_LENGTH + TAG_LENGTH)
  const data      = ciphertext.subarray(SALT_LEN + IV_LENGTH + TAG_LENGTH)
  const key       = scryptSync(secret, salt, 32) as Buffer

  const decipher  = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  return Buffer.concat([decipher.update(data), decipher.final()])
}

/** Computes SHA-256 checksum of a buffer */
export function computeChecksum(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

/** Verifies a buffer matches its expected checksum */
export function verifyChecksum(data: Buffer, expectedChecksum: string): boolean {
  const actual = computeChecksum(data)
  return actual === expectedChecksum
}

export async function doubleEncryptClassified(data: Buffer): Promise<Buffer> {
  // First layer: standard backup encryption
  const layer1 = await encryptBackupData(data)

  // Second layer: with a dedicated classified secret
  const classifiedSecret = process.env.CLASSIFIED_BACKUP_SECRET
  if (!classifiedSecret) throw new Error('CLASSIFIED_BACKUP_SECRET not set.')

  const salt   = randomBytes(32)
  const iv     = randomBytes(16)
  const key    = scryptSync(classifiedSecret, salt, 32) as Buffer
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc    = Buffer.concat([cipher.update(layer1), cipher.final()])
  const tag    = cipher.getAuthTag()

  return Buffer.concat([salt, iv, tag, enc])
}