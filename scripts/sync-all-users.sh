#!/bin/bash

# 🔄 Manual Sync Enabled Users Script
# Usage: ./sync-all-users.sh <FRAPPE_TOKEN>

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
TICKET_SERVICE_URL="${TICKET_SERVICE_URL:-https://admin.sis.wellspring.edu.vn}"
SYNC_ENDPOINT="/api/ticket/user/sync/manual"
FULL_URL="${TICKET_SERVICE_URL}${SYNC_ENDPOINT}"

# Get token from argument
TOKEN="${1}"

if [ -z "$TOKEN" ]; then
    echo -e "${RED}❌ Error: Token required${NC}"
    echo "Usage: ./sync-all-users.sh <FRAPPE_TOKEN>"
    echo ""
    echo "Example:"
    echo "  ./sync-all-users.sh eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
    exit 1
fi

    echo -e "${YELLOW}🔄 Starting Enabled User Sync...${NC}"
    echo "URL: $FULL_URL (enabled users only)"
    echo ""

# Make request
response=$(curl -s -X POST "$FULL_URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -w "\n%{http_code}")

# Extract body and status code
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

echo "Response:"
echo "$body" | jq '.' 2>/dev/null || echo "$body"
echo ""

if [ "$http_code" = "200" ]; then
    echo -e "${GREEN}✅ Sync completed successfully!${NC}"
    
    # Parse response for stats
    stats=$(echo "$body" | jq '.stats' 2>/dev/null)
    if [ ! -z "$stats" ]; then
        synced=$(echo "$stats" | jq '.synced')
        failed=$(echo "$stats" | jq '.failed')
        echo -e "${GREEN}📊 Stats: $synced synced, $failed failed${NC}"
    fi
else
    echo -e "${RED}❌ Sync failed with status code: $http_code${NC}"
    exit 1
fi
