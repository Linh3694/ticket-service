require('dotenv').config({ path: require('path').join(__dirname, '../config.env') });
const mongoose = require('mongoose');
const Ticket = require('../models/Ticket');

/**
 * Script để tạo unique index cho emailId field
 * Chạy script này sau khi deploy code mới
 */
async function createEmailIdIndex() {
  try {
    console.log('🔄 Connecting to MongoDB...');
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    
    if (!mongoUri) {
      console.error('❌ MONGODB_URI not found in environment variables');
      console.log('Available env vars:', Object.keys(process.env).filter(k => k.includes('MONGO')));
      process.exit(1);
    }
    
    console.log(`   Using MongoDB URI: ${mongoUri.replace(/\/\/.*@/, '//*****@')}`);
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    console.log('🔄 Creating unique sparse index for emailId...');
    
    // Tạo index với sparse: true (chỉ index documents có emailId)
    await Ticket.collection.createIndex(
      { emailId: 1 }, 
      { 
        unique: true, 
        sparse: true,
        background: true // Tạo index ở background để không block database
      }
    );
    
    console.log('✅ Index created successfully');

    // Kiểm tra index đã tạo
    const indexes = await Ticket.collection.indexes();
    console.log('\n📋 Current indexes on Ticket collection:');
    indexes.forEach(index => {
      console.log(`  - ${JSON.stringify(index.key)}: ${JSON.stringify(index)}`);
    });

    // Kiểm tra duplicate emailId hiện có
    console.log('\n🔍 Checking for duplicate emailId in existing tickets...');
    const duplicates = await Ticket.aggregate([
      { $match: { emailId: { $exists: true, $ne: null } } },
      { $group: { _id: '$emailId', count: { $sum: 1 }, tickets: { $push: '$ticketCode' } } },
      { $match: { count: { $gt: 1 } } }
    ]);

    if (duplicates.length > 0) {
      console.log('⚠️  Found duplicate emailId:');
      duplicates.forEach(dup => {
        console.log(`  - emailId: ${dup._id}, count: ${dup.count}, tickets: ${dup.tickets.join(', ')}`);
      });
      console.log('\n⚠️  Please review and remove duplicate tickets manually before running this script');
    } else {
      console.log('✅ No duplicate emailId found');
    }

    console.log('\n✅ Migration completed successfully');
    process.exit(0);

  } catch (error) {
    console.error('❌ Migration failed:', error);
    
    if (error.code === 11000) {
      console.error('\n⚠️  Duplicate key error: emailId already has duplicates in database');
      console.error('Please run the duplicate check query and remove duplicates manually:');
      console.error('\ndb.tickets.aggregate([');
      console.error('  { $match: { emailId: { $exists: true, $ne: null } } },');
      console.error('  { $group: { _id: "$emailId", count: { $sum: 1 }, tickets: { $push: "$ticketCode" } } },');
      console.error('  { $match: { count: { $gt: 1 } } }');
      console.error('])');
    }
    
    process.exit(1);
  }
}

// Chạy migration
createEmailIdIndex();






