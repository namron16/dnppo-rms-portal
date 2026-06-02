// lib/gdrive-pool/index.ts
// Barrel export — import everything from '@/lib/gdrive-pool'

// Types
export type {
  DbUser,
  DbStoragePool,
  DbStoragePoolFull,
  DbCategoryFolder,
  DbRecord,
  DbHealthEvent,
  PoolSummary,
  UploadTarget,
  IncrementResult,
  PoolStatus,
  UserRole,
  GoogleOAuthTokens,
  GoogleUserInfo,
  DriveFileMetadata,
  DriveFolderResult,
  DocumentCategory,
  UploadRequest,
  UploadResult,
  DeleteRequest,
  DeleteResult,
  PoolSelectionStrategy,
  PoolSelectionOptions,
  AccountHealthResult,
  SystemHealthReport,
  HealthStatus,
  ConnectAccountRequest,
  ConnectAccountResult,
  DisconnectAccountResult,
} from './types'

export { CATEGORY_DISPLAY_NAMES } from './types'

// Crypto utilities
export { encryptToken, decryptToken, isTokenValid, expiryFromSecondsNow } from './crypto'

// Database helpers (server-side only)
export {
  getServiceClient,
  getAllPoolAccounts,
  getPoolAccountFull,
  getPoolAccountByUsername,
  getDecryptedRefreshToken,
  getCachedAccessToken,
  saveAccessToken,
  upsertPoolAccount,
  deactivatePoolAccount,
  markPoolAccountError,
  updateHealthCheckResult,
  getCachedFolderId,
  cacheFolderId,
  getAllCachedFolders,
  insertRecord,
  getRecordByDriveId,
  getRecordsByEntity,
  getRecordsByCategory,
  markRecordInaccessible,
  deleteRecord,
  getInaccessibleRecords,
  logHealthEvent,
  getRecentHealthEvents,
  rpcIncrementStorage,
  rpcDecrementStorage,
  rpcGetPoolSummary,
  rpcPickUploadTarget,
} from './db'

// Drive client (server-side only)
export {
  getAuthorizedClient,
  getDriveClient,
  findOrCreateFolder,
  createRootFolder,
  uploadFileToDrive,
  deleteFileFromDrive,
  getFileMetadata,
  getDriveQuota,
  pingDriveAccount,
  getAuthorizationUrl,
  exchangeCodeForTokens,
  getAuthenticatedEmail,
} from './drive-client'

// Upload gateway (server-side only)
export {
  uploadFile,
  deleteFile,
  moveFileToArchiveFolder,
  moveFileFromArchiveFolder,
  buildDirectDownloadUrl,
  buildPreviewUrl,
} from './gateway'

// Personnel archive (server-side only)
export {
  archivePersonnelFilesToDrive,
  archiveBatchPersonnelFiles,
} from './archive-personnel'

export type {
  PersonnelArchiveInput,
  PersonnelArchiveResult,
} from './archive-personnel'

// Health monitoring (server-side only)
export {
  checkAccountHealth,
  runSystemHealthCheck,
  scanFileAccessibility,
  repairBrokenAccounts,
  getQuickStatus,
} from './health'

// Modal adapters (server-side only)
export {
  uploadViaPool,
  deleteViaPool,
  uploadMasterDocument,
  uploadSpecialOrder,
  uploadJournalAttachment,
  uploadConfidentialDoc,
  uploadLibraryItem,
  upload201Document,
  uploadAvatarViaPool,
} from './migrate-modal'