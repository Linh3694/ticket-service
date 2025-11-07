const axios = require('axios');

// Test script để debug avatar fetching
async function testAvatarFetch() {
  try {
    console.log('🧪 Testing avatar fetch logic...');

    // Test Frappe API call
    const FRAPPE_API_URL = 'https://admin.sis.wellspring.edu.vn';
    const email = 'linh.nguyenhai@wellspring.edu.vn';

    console.log('🔍 Testing Frappe API call...');
    const response = await axios.get(`${FRAPPE_API_URL}/api/resource/User?filters=[["email","=","${email}"]]`, {
      headers: {
        'Authorization': 'Bearer YOUR_TOKEN', // You'll need to replace with actual token
      }
    });

    console.log('📡 Frappe API Response:', JSON.stringify(response.data, null, 2));

    if (response.data.data && response.data.data.length > 0) {
      const user = response.data.data[0];
      console.log('👤 User found:', user);
      console.log('User image fields:');
      console.log('- user_image:', user.user_image);
      console.log('- avatar_url:', user.avatar_url);
      console.log('- avatar:', user.avatar);
      console.log('- photo:', user.photo);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Full error:', error);
  }
}

testAvatarFetch();
