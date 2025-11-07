#!/bin/bash

# Ticket Service Email Cronjob Setup Script
# Sets up PM2 cronjob to fetch emails every 1 minute

echo "🚀 Setting up Ticket Service Email Cronjob..."

# Create logs directory if not exists
mkdir -p logs

# Stop existing cronjob if running
echo "🛑 Stopping existing cronjob..."
pm2 delete ticket-service-cron-emails 2>/dev/null || echo "No existing cronjob found"

# Start new cronjob
echo "▶️  Starting email fetch cronjob..."
pm2 start ecosystem-cron.config.js

# Save PM2 configuration
echo "💾 Saving PM2 configuration..."
pm2 save

# Setup startup script (optional)
echo "🔄 Setting up PM2 startup..."
pm2 startup | grep -v "sudo" | bash

echo ""
echo "✅ Email cronjob setup completed!"
echo ""
echo "📊 Monitor commands:"
echo "  pm2 status"
echo "  pm2 logs ticket-service-cron-emails"
echo "  pm2 logs ticket-service-cron-emails --lines 50"
echo ""
echo "🛑 Stop commands:"
echo "  pm2 stop ticket-service-cron-emails"
echo "  pm2 delete ticket-service-cron-emails"
echo ""
echo "📝 Cronjob will fetch emails every 1 minute from:"
echo "  - Email: it@wellspring.edu.vn"
echo "  - API: http://localhost:5001/api/email/fetch-emails"
echo ""
echo "🎯 Test manually:"
echo "  npm run cron-emails"
