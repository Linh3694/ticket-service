#!/usr/bin/env node
/**
 * Clean up old fields from SupportTeamMember documents
 * 
 * Removes deprecated fields: fullname, avatarUrl, department, jobTitle
 * These fields should be populated dynamically from Users collection
 * 
 * Usage: node scripts/cleanup-support-team-old-fields.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/wellspring_tickets';

async function cleanupOldFields() {
  try {
    console.log('🔄 Connecting to MongoDB...');
    console.log(`📍 Connection string: ${MONGODB_URI}`);
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    console.log(`📍 Database: ${mongoose.connection.db.databaseName}`);

    const SupportTeamMember = mongoose.connection.collection('supportteammembers');
    
    // Check total documents first
    const totalDocs = await SupportTeamMember.countDocuments({});
    console.log(`\n📊 Total SupportTeamMember documents: ${totalDocs}`);
    
    // Show ALL documents to debug
    console.log('\n🔍 All documents (checking for old fields):');
    const allDocs = await SupportTeamMember.find({}).limit(5).toArray();
    allDocs.forEach((doc, idx) => {
      console.log(`\nDocument ${idx + 1}:`);
      console.log(`  - email: ${doc.email}`);
      console.log(`  - has fullname: ${doc.fullname !== undefined}`);
      console.log(`  - has avatarUrl: ${doc.avatarUrl !== undefined}`);
      console.log(`  - has department: ${doc.department !== undefined}`);
      console.log(`  - has jobTitle: ${doc.jobTitle !== undefined}`);
    });
    
    // Count documents with old fields (ANY of them)
    const count = await SupportTeamMember.countDocuments({
      $or: [
        { fullname: { $exists: true } },
        { avatarUrl: { $exists: true } },
        { department: { $exists: true } },
        { jobTitle: { $exists: true } }
      ]
    });
    
    console.log(`\n📊 Documents with old fields: ${count}`);
    
    if (count === 0) {
      console.log('✅ No old fields found (this should not happen if documents shown above have these fields)');
      console.log('⚠️  Check if schema is preventing field access');
      process.exit(0);
    }
    
    // Remove old fields
    console.log('\n🧹 Removing old fields...');
    const result = await SupportTeamMember.updateMany(
      {},
      {
        $unset: {
          fullname: "",
          avatarUrl: "",
          department: "",
          jobTitle: ""
        }
      }
    );
    
    console.log(`✅ Updated ${result.modifiedCount} documents`);
    console.log('\n💡 Fields removed: fullname, avatarUrl, department, jobTitle');
    console.log('💡 These fields will now be populated dynamically from Users collection');
    
    // Show sample after cleanup
    console.log('\n📋 Sample document after cleanup:');
    const sample = await SupportTeamMember.findOne({});
    console.log(JSON.stringify(sample, null, 2));
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ MongoDB connection closed');
  }
}

cleanupOldFields();

