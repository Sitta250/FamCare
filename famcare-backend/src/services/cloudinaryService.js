let cloudinaryClientPromise

async function getCloudinaryClient() {
  if (!process.env.CLOUDINARY_URL) {
    throw Object.assign(new Error('CLOUDINARY_URL is not configured'), {
      status: 500,
      code: 'UPLOAD_UNAVAILABLE',
    })
  }

  if (!cloudinaryClientPromise) {
    cloudinaryClientPromise = import('cloudinary').then(({ v2 }) => {
      v2.config({ secure: true })
      return v2
    })
  }

  return cloudinaryClientPromise
}

function baseName(filename = 'upload') {
  return filename.replace(/\.[^/.]+$/, '')
}

export async function uploadBuffer(buffer, { folder, resourceType, originalname }) {
  const cloudinary = await getCloudinaryClient()

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: resourceType,
        use_filename: true,
        unique_filename: true,
        filename_override: baseName(originalname),
      },
      (err, result) => {
        if (err) {
          reject(err)
          return
        }
        resolve(result)
      }
    )

    stream.end(buffer)
  })
}

export async function deleteByPublicId(publicId) {
  if (!publicId) return

  try {
    const cloudinary = await getCloudinaryClient()
    await cloudinary.uploader.destroy(publicId)
  } catch (err) {
    console.error('[cloudinary] delete failed:', err.message)
  }
}
