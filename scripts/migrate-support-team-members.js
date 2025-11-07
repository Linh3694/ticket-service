#!/usr/bin/env node

/**
 * Migration Script: Remove duplicate fields from SupportTeamMember
 * 
 * Sau khi refactor SupportTeamMember model để không còn lưu duplicate data
 * (fullname, avatarUrl, department), script này sẽ:
 * 
 * 1. Xóa các fields duplicate khỏi tất cả SupportTeamMember documents
 * 2. Đảm bảo email field được set đúng
 * 3. Verify rằng tất cả members có email hợp lệ và user tồn tại trong Users collection
 * 4. Clean up userId field cũ (deprecated)
 */

require('dotenv').config();
const mongoose = require('mongoose');

// MongoDB connection
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/wellspring_tickets';

async function migrate() {
  try {
    console.log('🚀 [Migration] Starting SupportTeamMember migration...');
    console.log(`📊 [Migration] Connecting to MongoDB: ${MONGO_URI}`);
    
    await mongoose.connect(MONGO_URI);
    console.log('✅ [Migration] Connected to MongoDB');
    
    const db = mongoose.connection.db;
    const supportTeamMembersCollection = db.collection('supportteammembers');
    const usersCollection = db.collection('users');
    
    // Step 1: Get all SupportTeamMember documents
    console.log('\n📋 [Migration] Step 1: Fetching all SupportTeamMember documents...');
    const members = await supportTeamMembersCollection.find({}).toArray();
    console.log(`   Found ${members.length} documents`);
    
    if (members.length === 0) {
      console.log('✅ [Migration] No documents to migrate. Exiting.');
      await mongoose.disconnect();
      return;
    }
    
    // Step 2: Analyze current state
    console.log('\n🔍 [Migration] Step 2: Analyzing current state...');
    let hasFullname = 0;
    let hasAvatarUrl = 0;
    let hasDepartment = 0;
    let hasEmail = 0;
    let missingEmail = 0;
    
    members.forEach(member => {
      if (member.fullname) hasFullname++;
      if (member.avatarUrl) hasAvatarUrl++;
      if (member.department) hasDepartment++;
      if (member.email) hasEmail++;
      else missingEmail++;
    });
    
    console.log(`   - Documents with fullname: ${hasFullname}`);
    console.log(`   - Documents with avatarUrl: ${hasAvatarUrl}`);
    console.log(`   - Documents with department: ${hasDepartment}`);
    console.log(`   - Documents with email: ${hasEmail}`);
    console.log(`   - Documents missing email: ${missingEmail}`);
    
    // Step 3: Migrate each document
    console.log('\n🔄 [Migration] Step 3: Migrating documents...');
    let migrated = 0;
    let skipped = 0;
    let failed = 0;
    const failedDocs = [];
    
    for (const member of members) {
      try {
        // Determine email
        let email = member.email;
        
        // If no email, try to use userId as fallback (if it's an email)
        if (!email && member.userId && member.userId.includes('@')) {
          email = member.userId;
          console.log(`   ℹ️  Using userId as email for ${member._id}: ${email}`);
        }
        
        if (!email) {
          console.warn(`   ⚠️  Skipping document ${member._id}: No valid email found`);
          skipped++;
          failedDocs.push({ _id: member._id, reason: 'No valid email' });
          continue;
        }
        
        // Verify user exists in Users collection
        const user = await usersCollection.findOne({ email });
        if (!user) {
          console.warn(`   ⚠️  Warning: User not found in Users collection for email: ${email}`);
          // Không skip, vẫn migrate nhưng log warning
        }
        
        // Prepare update
        const updateFields = {
          email: email
        };
        
        // Remove duplicate fields
        const unsetFields = {};
        if (member.fullname !== undefined) unsetFields.fullname = '';
        if (member.avatarUrl !== undefined) unsetFields.avatarUrl = '';
        if (member.department !== undefined) unsetFields.department = '';
        
        const updateOps = {
          $set: updateFields
        };
        
        if (Object.keys(unsetFields).length > 0) {
          updateOps.$unset = unsetFields;
        }
        
        // Perform update
        await supportTeamMembersCollection.updateOne(
          { _id: member._id },
          updateOps
        );
        
        migrated++;
        
        // Log progress every 10 documents
        if (migrated % 10 === 0) {
          console.log(`   📊 Progress: ${migrated}/${members.length} documents migrated`);
        }
      } catch (err) {
        console.error(`   ❌ Error migrating document ${member._id}:`, err.message);
        failed++;
        failedDocs.push({ _id: member._id, reason: err.message });
      }
    }
    
    // Step 4: Summary
    console.log('\n📊 [Migration] Summary:');
    console.log(`   ✅ Successfully migrated: ${migrated}`);
    console.log(`   ⏭️  Skipped: ${skipped}`);
    console.log(`   ❌ Failed: ${failed}`);
    
    if (failedDocs.length > 0) {
      console.log('\n⚠️  [Migration] Failed documents:');
      failedDocs.forEach(doc => {
        console.log(`   - ${doc._id}: ${doc.reason}`);
      });
    }
    
    // Step 5: Verify migration
    console.log('\n🔍 [Migration] Step 4: Verifying migration...');
    const afterMembers = await supportTeamMembersCollection.find({}).toArray();
    
    let stillHasFullname = 0;
    let stillHasAvatarUrl = 0;
    let stillHasDepartment = 0;
    let stillMissingEmail = 0;
    
    afterMembers.forEach(member => {
      if (member.fullname) stillHasFullname++;
      if (member.avatarUrl) stillHasAvatarUrl++;
      if (member.department) stillHasDepartment++;
      if (!member.email) stillMissingEmail++;
    });
    
    console.log(`   - Documents still with fullname: ${stillHasFullname}`);
    console.log(`   - Documents still with avatarUrl: ${stillHasAvatarUrl}`);
    console.log(`   - Documents still with department: ${stillHasDepartment}`);
    console.log(`   - Documents still missing email: ${stillMissingEmail}`);
    
    if (stillHasFullname === 0 && stillHasAvatarUrl === 0 && stillHasDepartment === 0) {
      console.log('\n✅ [Migration] Migration completed successfully!');
      console.log('   All duplicate fields have been removed.');
    } else {
      console.log('\n⚠️  [Migration] Migration completed with warnings.');
      console.log('   Some documents still have duplicate fields.');
    }
    
    await mongoose.disconnect();
    console.log('\n👋 [Migration] Disconnected from MongoDB');
    
  } catch (error) {
    console.error('❌ [Migration] Fatal error:', error);
    process.exit(1);
  }
}

// Run migration
if (require.main === module) {
  migrate()
    .then(() => {
      console.log('\n✨ [Migration] Done!');
      process.exit(0);
    })
    .catch(err => {
      console.error('❌ [Migration] Unhandled error:', err);
      process.exit(1);
    });
}

module.exports = migrate;

