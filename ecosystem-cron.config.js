module.exports = {
  apps: [{
    name: 'ticket-service-cron-emails',
    script: 'cron-fetch-emails.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '256M',
    env: {
      NODE_ENV: 'production',
      TICKET_SERVICE_URL: 'http://localhost:5001'
    },
    error_file: './logs/cron-emails-error.log',
    out_file: './logs/cron-emails-out.log',
    log_file: './logs/cron-emails.log',
    time: true
  }, {
    name: 'ticket-service-cron-sync-users',
    script: 'scripts/sync-users-cron.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '256M',
    cron_restart: '0 2 * * *', // Chạy hàng ngày lúc 2:00 AM
    env: {
      NODE_ENV: 'production'
    },
    error_file: './logs/cron-sync-users-error.log',
    out_file: './logs/cron-sync-users-out.log',
    log_file: './logs/cron-sync-users.log',
    time: true
  }]
};
