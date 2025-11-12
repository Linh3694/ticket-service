/**
 * Winston Logger for Ticket Service
 * Structured JSON logging cho tất cả operations
 */

const winston = require('winston');
const os = require('os');

// Custom JSON formatter
const jsonFormat = winston.format.printf(({ timestamp, level, message, ...meta }) => {
  const logObject = {
    timestamp,
    level,
    service: 'ticket',
    message,
  };

  // Add metadata fields if present
  if (meta.user_email) logObject.user_email = meta.user_email;
  if (meta.user_name) logObject.user_name = meta.user_name;
  if (meta.action) logObject.action = meta.action;
  if (meta.ticket_id) logObject.ticket_id = meta.ticket_id;
  if (meta.status) logObject.status = meta.status;
  if (meta.old_status) logObject.old_status = meta.old_status;
  if (meta.new_status) logObject.new_status = meta.new_status;
  if (meta.duration_ms) logObject.duration_ms = meta.duration_ms;
  if (meta.http_status) logObject.http_status = meta.http_status;
  if (meta.ip) logObject.ip = meta.ip;
  if (meta.details) logObject.details = meta.details;

  return JSON.stringify(logObject, null, 0);
});

// Create logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss Z' }),
    jsonFormat
  ),
  defaultMeta: { service: 'ticket' },
  transports: [
    // Console transport for PM2 capture
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss Z' }),
        jsonFormat
      ),
    }),
  ],
});

/**
 * Log user action (create, update, status change, etc.)
 */
function logUserAction(user_email, user_name, action, ticket_id, details = {}) {
  logger.info(`Ticket ${action}`, {
    user_email,
    user_name,
    action: `ticket_${action}`,
    ticket_id,
    details,
  });
}

/**
 * Log ticket creation
 */
function logTicketCreated(user_email, user_name, ticket_id, title, category, priority = 'Normal') {
  logUserAction(user_email, user_name, 'created', ticket_id, {
    title,
    category,
    priority,
    created_at: new Date().toISOString(),
  });
}

/**
 * Log ticket status change
 */
function logTicketStatusChanged(user_email, user_name, ticket_id, old_status, new_status) {
  logUserAction(user_email, user_name, 'status_changed', ticket_id, {
    old_status,
    new_status,
    changed_at: new Date().toISOString(),
  });
}

/**
 * Log message sent
 */
function logMessageSent(user_email, user_name, ticket_id, message_length, has_attachments = false) {
  logUserAction(user_email, user_name, 'message_sent', ticket_id, {
    message_length,
    has_attachments,
    sent_at: new Date().toISOString(),
  });
}

/**
 * Log ticket accepted
 */
function logTicketAccepted(user_email, user_name, ticket_id) {
  logUserAction(user_email, user_name, 'accepted', ticket_id, {
    accepted_at: new Date().toISOString(),
  });
}

/**
 * Log ticket closed/resolved
 */
function logTicketResolved(user_email, user_name, ticket_id, resolution_time_minutes) {
  logUserAction(user_email, user_name, 'resolved', ticket_id, {
    resolution_time_minutes,
    resolved_at: new Date().toISOString(),
  });
}

/**
 * Log ticket cancelled
 */
function logTicketCancelled(user_email, user_name, ticket_id, reason = '') {
  logUserAction(user_email, user_name, 'cancelled', ticket_id, {
    reason,
    cancelled_at: new Date().toISOString(),
  });
}

/**
 * Log ticket reopened
 */
function logTicketReopened(user_email, user_name, ticket_id, previous_status) {
  logUserAction(user_email, user_name, 'reopened', ticket_id, {
    previous_status,
    reopened_at: new Date().toISOString(),
  });
}

/**
 * Log API call with response time
 */
function logAPICall(user_email, method, endpoint, response_time_ms, http_status, ip = '') {
  const level = http_status >= 400 ? 'warn' : 'info';
  const slow_marker = response_time_ms > 2000 ? ' [CHẬM]' : '';

  logger[level](`API${slow_marker}: ${method} ${endpoint}`, {
    user_email,
    action: `api_${method.toLowerCase()}`,
    duration_ms: response_time_ms,
    http_status,
    ip,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Log error
 */
function logError(user_email, action, error_message, ticket_id = '', details = {}) {
  logger.error(`Lỗi: ${action}`, {
    user_email,
    action,
    ticket_id,
    error_message,
    details,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Log cache operation
 */
function logCacheOperation(operation, key, hit = null) {
  const action = hit ? 'cache_hit' : hit === false ? 'cache_miss' : 'cache_invalidate';
  logger.info(`Cache ${operation}`, {
    action,
    key,
    timestamp: new Date().toISOString(),
  });
}

module.exports = {
  logger,
  logUserAction,
  logTicketCreated,
  logTicketStatusChanged,
  logMessageSent,
  logTicketAccepted,
  logTicketResolved,
  logTicketCancelled,
  logTicketReopened,
  logAPICall,
  logError,
  logCacheOperation,
};

