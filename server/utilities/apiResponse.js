/**
 * Unified API response helpers.
 * All controllers should use these instead of ad-hoc res.status().json().
 *
 * Success shape: { success: true, data, meta? }
 * Error shape:   { success: false, message, errors? }
 */

const success = (res, data, status = 200, meta) => {
  const body = { success: true, data };
  if (meta) body.meta = meta;
  return res.status(status).json(body);
};

const fail = (res, message, status = 400, errors) => {
  const body = { success: false, message };
  if (errors) body.errors = errors;
  return res.status(status).json(body);
};

const notFound = (res, message = "Resource not found") =>
  fail(res, message, 404);

const unauthorized = (res, message = "Unauthorized") =>
  fail(res, message, 403);

const serverError = (res, err, message) => {
  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  const body = isProd ? 'Server Error' : (message || err?.message || 'Internal Server Error');
  return fail(res, body, 500);
};

module.exports = { success, fail, notFound, unauthorized, serverError };
