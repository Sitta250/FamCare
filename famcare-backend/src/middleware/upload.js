import multer from 'multer'

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024

const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
])

const ALLOWED_AUDIO_MIME_TYPES = new Set([
  'audio/mpeg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/wav',
  'audio/ogg',
  'audio/webm',
  'audio/aac',
])

function createFileFilter(allowedMimeTypes) {
  return (_req, file, cb) => {
    if (allowedMimeTypes.has(file.mimetype)) {
      cb(null, true)
      return
    }

    cb(Object.assign(new Error('Unsupported file type'), {
      status: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE',
    }))
  }
}

function createUploader(allowedMimeTypes) {
  return multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_FILE_SIZE_BYTES,
    },
    fileFilter: createFileFilter(allowedMimeTypes),
  }).single('file')
}

export const uploadSingle = createUploader(ALLOWED_UPLOAD_MIME_TYPES)
export const uploadAudio = createUploader(ALLOWED_AUDIO_MIME_TYPES)
export const uploadInsurancePhotos = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
  },
  fileFilter: createFileFilter(ALLOWED_UPLOAD_MIME_TYPES),
}).fields([
  { name: 'frontPhoto', maxCount: 1 },
  { name: 'backPhoto', maxCount: 1 },
])
