export function errorHandler(err, _req, res, _next) {
  const isMulterError = err?.name === 'MulterError'

  let status = err.status || err.statusCode || 500;
  let code = err.code || "INTERNAL_ERROR";
  const message = err.message || "Internal Server Error";

  if (isMulterError) {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400
    code = err.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'BAD_REQUEST'
  }

  if (status >= 500) {
    console.error(err);
  }
  res.status(status).json({ error: message, code });
}
