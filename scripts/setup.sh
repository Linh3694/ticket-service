#!/bin/bash

# Ticket Service Setup Script for Ubuntu
# Author: Wellspring
# Version: 1.0.0

set -e

echo "🚀 [Ticket Service] Bắt đầu cài đặt..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   print_error "Script này không nên chạy với quyền root"
   exit 1
fi

# Update system
print_status "Cập nhật hệ thống..."
sudo apt update && sudo apt upgrade -y

# Install Node.js 18.x
print_status "Cài đặt Node.js 18.x..."
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 globally
print_status "Cài đặt PM2..."
sudo npm install -g pm2

# Install Redis
print_status "Cài đặt Redis..."
sudo apt install -y redis-server

# Start and enable Redis
sudo systemctl start redis-server
sudo systemctl enable redis-server

# Install MariaDB
print_status "Cài đặt MariaDB..."
sudo apt install -y mariadb-server mariadb-client

# Start and enable MariaDB
sudo systemctl start mariadb
sudo systemctl enable mariadb

# Secure MariaDB installation
print_warning "Cấu hình bảo mật MariaDB..."
sudo mysql_secure_installation

# Create database and user for ticket service
print_status "Tạo database và user cho ticket service..."
sudo mysql -u root -p << EOF
CREATE DATABASE IF NOT EXISTS ticket_service;
CREATE USER IF NOT EXISTS 'ticket_user'@'localhost' IDENTIFIED BY 'ticket_password_2025';
GRANT ALL PRIVILEGES ON ticket_service.* TO 'ticket_user'@'localhost';
FLUSH PRIVILEGES;
EOF

# Create logs directory
mkdir -p logs

# Install project dependencies
print_status "Cài đặt dependencies..."
npm install

# Copy environment file
if [ ! -f config.env ]; then
    print_status "Tạo file config.env..."
    cp config.env.example config.env
    print_warning "Vui lòng cập nhật file config.env với thông tin database và Redis"
fi

# Create database tables
print_status "Tạo bảng database..."
node -e "
const database = require('./config/database');
const fs = require('fs');

const createTables = async () => {
  try {
    await database.connect();
    
    const createTicketTable = \`
      CREATE TABLE IF NOT EXISTS \`tabERP Ticket\` (
        name VARCHAR(255) PRIMARY KEY,
        title TEXT NOT NULL,
        description LONGTEXT,
        ticket_type VARCHAR(50) DEFAULT 'support',
        priority VARCHAR(20) DEFAULT 'medium',
        status VARCHAR(20) DEFAULT 'open',
        creator VARCHAR(255),
        assigned_to VARCHAR(255),
        category VARCHAR(100),
        resolution LONGTEXT,
        attachments JSON,
        tags JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        resolved_at TIMESTAMP NULL,
        closed_at TIMESTAMP NULL,
        creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        modified TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        owner VARCHAR(255) DEFAULT 'Administrator',
        modified_by VARCHAR(255) DEFAULT 'Administrator',
        docstatus INT DEFAULT 0,
        idx INT DEFAULT 0,
        INDEX idx_status (status),
        INDEX idx_priority (priority),
        INDEX idx_creator (creator),
        INDEX idx_assigned_to (assigned_to),
        INDEX idx_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    \`;
    
    await database.query(createTicketTable);
    console.log('✅ Bảng ticket đã được tạo thành công');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Lỗi tạo bảng:', error);
    process.exit(1);
  }
};

createTables();
"

# Setup PM2 ecosystem
print_status "Cấu hình PM2..."
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup

print_status "✅ Cài đặt hoàn tất!"
print_status "🎯 Ticket Service đang chạy trên port 5004"
print_status "📊 PM2 Status: pm2 status"
print_status "📝 Logs: pm2 logs ticket-service"
print_status "🔄 Restart: pm2 restart ticket-service"
print_status "⏹️ Stop: pm2 stop ticket-service"

echo ""
print_warning "Vui lòng cập nhật file config.env với thông tin database và Redis thực tế"
print_warning "Sau đó restart service: pm2 restart ticket-service" 