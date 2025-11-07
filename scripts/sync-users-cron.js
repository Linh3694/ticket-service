#!/usr/bin/env node

/**
 * 🔄 Daily Cron Job: Sync All Users from Frappe
 * 
 * This script runs automatically via cron to sync all users from Frappe
 * as a backup in case webhooks fail.
 * 
 * Usage: node sync-users-cron.js
 * 
 * Requires environment variables:
 * - FRAPPE_API_KEY and FRAPPE_API_SECRET (preferred)
 * - OR FRAPPE_API_TOKEN (fallback)
 * - FRAPPE_API_URL (optional, defaults to https://admin.sis.wellspring.edu.vn)
 * - TICKET_SERVICE_URL (optional, defaults to FRAPPE_API_URL)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../config.env') });

const axios = require('axios');

const FRAPPE_API_URL = process.env.FRAPPE_API_URL || 'https://admin.sis.wellspring.edu.vn';
const TICKET_SERVICE_URL = process.env.TICKET_SERVICE_URL || FRAPPE_API_URL;

// Build auth token - prefer API key/secret, fallback to token
function getAuthToken() {
  if (process.env.FRAPPE_API_KEY && process.env.FRAPPE_API_SECRET) {
    // Use API key/secret to get token
    // For now, we'll use the token method directly
    // In production, you might want to exchange key/secret for token
    return null; // Will use key/secret directly
  }
  
  if (process.env.FRAPPE_API_TOKEN) {
    return process.env.FRAPPE_API_TOKEN;
  }
  
  return null;
}

// Build auth headers
function buildAuthHeaders() {
  const headers = {
    'Content-Type': 'application/json'
  };
  
  if (process.env.FRAPPE_API_KEY && process.env.FRAPPE_API_SECRET) {
    headers['Authorization'] = `token ${process.env.FRAPPE_API_KEY}:${process.env.FRAPPE_API_SECRET}`;
  } else if (process.env.FRAPPE_API_TOKEN) {
    headers['Authorization'] = `Bearer ${process.env.FRAPPE_API_TOKEN}`;
    headers['X-Frappe-CSRF-Token'] = process.env.FRAPPE_API_TOKEN;
  } else {
    throw new Error('Missing authentication: FRAPPE_API_KEY/FRAPPE_API_SECRET or FRAPPE_API_TOKEN required');
  }
  
  return headers;
}

const syncAllUsers = async () => {
  const startTime = new Date();
  console.log(`\n🔄 [Cron] Starting daily user sync at ${startTime.toISOString()}`);
  
  try {
    const headers = buildAuthHeaders();
    const url = `${TICKET_SERVICE_URL}/api/ticket/user/sync/manual`;
    
    console.log(`📡 Calling: ${url}`);
    
    const response = await axios.post(url, {}, {
      headers,
      timeout: 300000 // 5 minutes timeout
    });
    
    const data = response.data;
    const endTime = new Date();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    if (data.success) {
      console.log(`✅ [Cron] Sync completed successfully in ${duration}s`);
      
      if (data.stats) {
        const { synced, failed } = data.stats;
        console.log(`📊 Stats:`);
        console.log(`   ✅ Synced: ${synced}`);
        console.log(`   ❌ Failed: ${failed}`);
        
        // Log to file or monitoring system if needed
        if (failed > 0) {
          console.warn(`⚠️  Warning: ${failed} users failed to sync`);
        }
      }
      
      console.log(`✅ [Cron] Daily sync completed at ${endTime.toISOString()}\n`);
      process.exit(0);
    } else {
      console.error(`❌ [Cron] Sync failed: ${data.message}`);
      process.exit(1);
    }
  } catch (error) {
    const endTime = new Date();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    console.error(`❌ [Cron] Error after ${duration}s:`);
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error(`Data: ${JSON.stringify(error.response.data, null, 2)}`);
    } else {
      console.error(error.message);
    }
    
    console.error(`❌ [Cron] Daily sync failed at ${endTime.toISOString()}\n`);
    process.exit(1);
  }
};

// Run sync
syncAllUsers();

