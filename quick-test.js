const axios = require('axios');
require("dotenv").config({ path: './config.env' });

const FRAPPE_API_URL = process.env.FRAPPE_API_URL || 'http://172.16.20.130:8000';

console.log('🔍 Quick Frappe Connection Test');
console.log(`📍 URL: ${FRAPPE_API_URL}`);
console.log('─'.repeat(40));

async function quickTest() {
  try {
    console.log('Testing connection...');
    
    const response = await axios.get(`${FRAPPE_API_URL}/api/method/frappe.utils.get_system_info`, {
      timeout: 3000
    });
    
    console.log('✅ Connection successful!');
    console.log(`Status: ${response.status}`);
    
    if (response.data && response.data.message) {
      console.log(`Frappe version: ${response.data.message.version || 'Unknown'}`);
    }
    
  } catch (error) {
    console.log('❌ Connection failed!');
    console.log(`Error: ${error.message}`);
    
    if (error.code === 'ECONNREFUSED') {
      console.log('💡 Tip: Frappe server might not be running or URL is incorrect');
    } else if (error.code === 'ENOTFOUND') {
      console.log('💡 Tip: Check if the Frappe URL is correct');
    }
  }
}

quickTest(); 