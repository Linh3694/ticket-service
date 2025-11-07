#!/usr/bin/env node

/**
 * Cron Job: Fetch emails and create tickets automatically
 * Runs every 5 minutes to check for new emails and create tickets
 */

const axios = require('axios');
require('dotenv').config({ path: './config.env' });

// Configuration
const TICKET_SERVICE_URL = process.env.TICKET_SERVICE_URL || 'http://localhost:5001';
const CRON_INTERVAL = 1 * 60 * 1000; // 1 minute in milliseconds

/**
 * Fetch emails and create tickets
 */
async function fetchEmailsAndCreateTickets() {
  try {
    console.log(`🔄 [Cron] Fetching emails at ${new Date().toISOString()}`);

    const response = await axios.get(`${TICKET_SERVICE_URL}/api/email/fetch-emails`, {
      timeout: 30000, // 30 seconds timeout
      headers: {
        'User-Agent': 'Ticket-Service-Cron/1.0',
        'X-Cron-Job': 'email-fetcher'
      }
    });

    if (response.data && response.data.success) {
      console.log(`✅ [Cron] Successfully processed ${response.data.processedEmails || 0} emails`);
    } else {
      console.warn(`⚠️  [Cron] API returned non-success response:`, response.data);
    }

  } catch (error) {
    console.error(`❌ [Cron] Error fetching emails:`, error.message);

    // Log more details for debugging
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Data:`, error.response.data);
    } else if (error.code) {
      console.error(`   Code: ${error.code}`);
    }
  }
}

/**
 * Main cron loop
 */
async function startCronJob() {
  console.log('🚀 [Cron] Starting email fetch cron job...');
  console.log(`📅 [Cron] Will run every ${CRON_INTERVAL / 1000 / 60} minutes`);
  console.log(`🔗 [Cron] Target URL: ${TICKET_SERVICE_URL}/api/email/fetch-emails`);

  // Initial run
  await fetchEmailsAndCreateTickets();

  // Set up interval
  setInterval(async () => {
    await fetchEmailsAndCreateTickets();
  }, CRON_INTERVAL);

  console.log('✅ [Cron] Email fetch cron job started successfully');
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('🛑 [Cron] Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('🛑 [Cron] Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

// Run if called directly
if (require.main === module) {
  startCronJob();
}

module.exports = { fetchEmailsAndCreateTickets, startCronJob };
