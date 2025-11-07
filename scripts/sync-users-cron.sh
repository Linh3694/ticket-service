#!/bin/bash

# 🔄 Daily Cron Job: Sync Enabled Users from Frappe
# 
# This script runs automatically via cron to sync only ENABLED users from Frappe
# as a backup in case webhooks fail. Optimized for performance.
#
# Usage: ./sync-users-cron.sh
#
# Make sure to set executable permission:
#   chmod +x sync-users-cron.sh

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_DIR="$(dirname "$SCRIPT_DIR")"

# Change to service directory
cd "$SERVICE_DIR" || exit 1

# Load environment variables
if [ -f "config.env" ]; then
    export $(cat config.env | grep -v '^#' | xargs)
fi

# Set defaults
FRAPPE_API_URL="${FRAPPE_API_URL:-https://admin.sis.wellspring.edu.vn}"
TICKET_SERVICE_URL="${TICKET_SERVICE_URL:-$FRAPPE_API_URL}"

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    echo "❌ Error: Node.js is not installed or not in PATH"
    exit 1
fi

# Check if required environment variables are set
if [ -z "$FRAPPE_API_KEY" ] && [ -z "$FRAPPE_API_SECRET" ] && [ -z "$FRAPPE_API_TOKEN" ]; then
    echo "❌ Error: Missing authentication"
    echo "   Please set FRAPPE_API_KEY/FRAPPE_API_SECRET or FRAPPE_API_TOKEN in config.env"
    exit 1
fi

# Run the sync script
echo "🔄 [Cron] Starting daily user sync..."
node "$SCRIPT_DIR/sync-users-cron.js"

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ [Cron] Daily sync completed successfully"
else
    echo "❌ [Cron] Daily sync failed with exit code $EXIT_CODE"
fi

exit $EXIT_CODE

