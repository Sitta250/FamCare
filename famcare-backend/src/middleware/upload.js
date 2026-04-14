import multer from 'multer'

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
])

export const uploadSingle = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true)
      return
    }

    cb(Object.assign(new Error('Unsupported file type'), {
      status: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE',
    }))
  },
}).single('file')
