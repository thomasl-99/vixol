#!/usr/bin/env node

/**
 * VIXOL Capacity Monitor
 * 
 * Monitors Server 2 (vixol.cloud) resources:
 * - RAM usage
 * - Disk usage
 * - Database connections
 * - Active users
 * - Query throughput
 * 
 * Auto-stops new user signups when threshold reached
 * Alerts Thomas when approaching limits
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// Configuration
const LIMITS = {
  RAM_THRESHOLD: 85,           // Stop at 85% RAM
  DISK_THRESHOLD: 90,          // Stop at 90% disk
  DB_CONNECTIONS_THRESHOLD: 95, // Stop at 95% max connections
  CONCURRENT_USERS_THRESHOLD: 95, // Stop at 95 concurrent users
  ALERT_THRESHOLD: 75,         // Alert at 75% capacity
};

const ALERT_CONFIG = {
  telegram_bot_token: process.env.TELEGRAM_BOT_TOKEN,
  telegram_chat_id: '8752725919', // Thomas
  alert_email: 'hello@vixol.cloud',
};

const LOG_FILE = '/var/log/vixol-capacity.log';
const STATUS_FILE = '/tmp/vixol-capacity-status.json';

// ============ MONITORING FUNCTIONS ============

/**
 * Get RAM usage percentage
 */
function getRamUsage() {
  try {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const percentage = Math.round((usedMem / totalMem) * 100);
    
    return {
      used_mb: Math.round(usedMem / (1024 * 1024)),
      total_mb: Math.round(totalMem / (1024 * 1024)),
      percentage,
      status: percentage > LIMITS.RAM_THRESHOLD ? 'CRITICAL' : 
              percentage > LIMITS.ALERT_THRESHOLD ? 'WARNING' : 'OK'
    };
  } catch (error) {
    logError('RAM check failed', error);
    return null;
  }
}

/**
 * Get disk usage percentage
 */
function getDiskUsage() {
  try {
    const result = execSync('df -h / | tail -1').toString().split(/\s+/);
    const used = result[2];
    const total = result[1];
    const percentage = parseInt(result[4]);
    
    return {
      used: used,
      total: total,
      percentage,
      status: percentage > LIMITS.DISK_THRESHOLD ? 'CRITICAL' :
              percentage > LIMITS.ALERT_THRESHOLD ? 'WARNING' : 'OK'
    };
  } catch (error) {
    logError('Disk check failed', error);
    return null;
  }
}

/**
 * Get PostgreSQL connection usage
 */
function getDbConnections() {
  try {
    // This would query PostgreSQL on Server 2
    // For now, simulated. In production, connect to actual DB.
    const result = {
      current: Math.floor(Math.random() * 50), // Simulated
      max: 100,
      percentage: 0,
      status: 'OK'
    };
    result.percentage = Math.round((result.current / result.max) * 100);
    result.status = result.percentage > LIMITS.DB_CONNECTIONS_THRESHOLD ? 'CRITICAL' :
                    result.percentage > LIMITS.ALERT_THRESHOLD ? 'WARNING' : 'OK';
    
    return result;
  } catch (error) {
    logError('DB connection check failed', error);
    return null;
  }
}

/**
 * Get active user count (simulated - would query DB)
 */
function getActiveUsers() {
  try {
    // In production: SELECT COUNT(*) FROM users WHERE active = true
    const result = {
      active_users: Math.floor(Math.random() * 80),
      max_capacity: 100,
      percentage: 0,
      status: 'OK'
    };
    result.percentage = Math.round((result.active_users / result.max_capacity) * 100);
    result.status = result.percentage > LIMITS.CONCURRENT_USERS_THRESHOLD ? 'CRITICAL' :
                    result.percentage > LIMITS.ALERT_THRESHOLD ? 'WARNING' : 'OK';
    
    return result;
  } catch (error) {
    logError('Active users check failed', error);
    return null;
  }
}

/**
 * Check query throughput (queries per minute)
 */
function getQueryThroughput() {
  try {
    // In production: COUNT queries from last minute
    return {
      queries_per_minute: Math.floor(Math.random() * 5000),
      status: 'OK'
    };
  } catch (error) {
    logError('Query throughput check failed', error);
    return null;
  }
}

// ============ DECISION LOGIC ============

/**
 * Determine if new signups should be allowed
 */
function shouldAllowNewSignups(metrics) {
  const ram = metrics.ram;
  const disk = metrics.disk;
  const db = metrics.db;
  const users = metrics.users;
  
  // ANY critical threshold = STOP signups
  const canStop = [
    ram?.status === 'CRITICAL',
    disk?.status === 'CRITICAL',
    db?.status === 'CRITICAL',
    users?.status === 'CRITICAL'
  ].some(x => x);
  
  return !canStop;
}

/**
 * Calculate overall server health (0-100%)
 */
function getServerHealth(metrics) {
  const scores = [
    metrics.ram?.percentage || 50,
    metrics.disk?.percentage || 50,
    metrics.db?.percentage || 50,
    metrics.users?.percentage || 50,
  ];
  
  return Math.round(scores.reduce((a, b) => a + b) / scores.length);
}

// ============ ALERTING ============

/**
 * Send alert via Telegram
 */
async function sendTelegramAlert(message) {
  try {
    if (!ALERT_CONFIG.telegram_bot_token) {
      console.warn('⚠️ TELEGRAM_BOT_TOKEN not set, skipping Telegram alert');
      return;
    }
    
    const payload = {
      chat_id: ALERT_CONFIG.telegram_chat_id,
      text: message,
      parse_mode: 'HTML'
    };
    
    // In production: Use message tool via API
    // For now: Log the alert
    logAlert(`TELEGRAM: ${message}`);
    
  } catch (error) {
    logError('Telegram alert failed', error);
  }
}

/**
 * Log alert message
 */
function logAlert(message) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ALERT: ${message}\n`;
  fs.appendFileSync(LOG_FILE, logEntry);
  console.log(`⚠️ ${message}`);
}

/**
 * Log error
 */
function logError(context, error) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ERROR (${context}): ${error.message}\n`;
  fs.appendFileSync(LOG_FILE, logEntry);
  console.error(`❌ ${context}: ${error.message}`);
}

// ============ MAIN MONITORING LOOP ============

async function checkCapacity() {
  console.log(`\n🔍 CAPACITY CHECK: ${new Date().toISOString()}`);
  
  // Gather metrics
  const metrics = {
    timestamp: new Date().toISOString(),
    ram: getRamUsage(),
    disk: getDiskUsage(),
    db: getDbConnections(),
    users: getActiveUsers(),
    throughput: getQueryThroughput(),
  };
  
  const health = getServerHealth(metrics);
  const allowSignups = shouldAllowNewSignups(metrics);
  
  // Build status
  const status = {
    ...metrics,
    health_percentage: health,
    allow_new_signups: allowSignups,
    limits: LIMITS,
  };
  
  // Save status file (for API queries)
  fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2));
  
  // Log metrics
  console.log(`\n📊 VIXOL CAPACITY STATUS:`);
  console.log(`   RAM:        ${metrics.ram?.percentage}% (${metrics.ram?.used_mb}/${metrics.ram?.total_mb} MB) [${metrics.ram?.status}]`);
  console.log(`   DISK:       ${metrics.disk?.percentage}% [${metrics.disk?.status}]`);
  console.log(`   DB CONNS:   ${metrics.db?.percentage}% [${metrics.db?.status}]`);
  console.log(`   USERS:      ${metrics.users?.percentage}% (${metrics.users?.active_users}/${metrics.users?.max_capacity}) [${metrics.users?.status}]`);
  console.log(`   THROUGHPUT: ${metrics.throughput?.queries_per_minute} q/min`);
  console.log(`   HEALTH:     ${health}%`);
  console.log(`   SIGNUPS:    ${allowSignups ? '✅ ALLOWED' : '❌ STOPPED'}`);
  
  // Check for alerts
  const alerts = [];
  
  if (metrics.ram?.status === 'CRITICAL') {
    alerts.push(`🚨 CRITICAL RAM: ${metrics.ram.percentage}% used!`);
  }
  if (metrics.disk?.status === 'CRITICAL') {
    alerts.push(`🚨 CRITICAL DISK: ${metrics.disk.percentage}% used!`);
  }
  if (metrics.db?.status === 'CRITICAL') {
    alerts.push(`🚨 CRITICAL DB CONNECTIONS: ${metrics.db.percentage}%!`);
  }
  if (metrics.users?.status === 'CRITICAL') {
    alerts.push(`🚨 CRITICAL USERS: ${metrics.users.percentage}% capacity!`);
  }
  
  if (metrics.ram?.status === 'WARNING') {
    alerts.push(`⚠️ WARNING RAM: ${metrics.ram.percentage}% used`);
  }
  if (metrics.disk?.status === 'WARNING') {
    alerts.push(`⚠️ WARNING DISK: ${metrics.disk.percentage}% used`);
  }
  if (metrics.db?.status === 'WARNING') {
    alerts.push(`⚠️ WARNING DB: ${metrics.db.percentage}% connections`);
  }
  if (metrics.users?.status === 'WARNING') {
    alerts.push(`⚠️ WARNING USERS: ${metrics.users.percentage}% capacity`);
  }
  
  // Send alerts if any
  if (alerts.length > 0) {
    const alertMessage = alerts.join('\n');
    console.log(`\n${alertMessage}`);
    
    // Send Telegram alert
    if (alerts.some(a => a.includes('CRITICAL'))) {
      await sendTelegramAlert(
        `🚨 <b>VIXOL SERVER 2 CRITICAL!</b>\n\n` +
        `${alertMessage}\n\n` +
        `New signups: <b>${allowSignups ? '✅ ALLOWED' : '❌ STOPPED'}</b>\n\n` +
        `Server health: ${health}%\n` +
        `<b>Action needed:</b> Review capacity + upgrade if needed`
      );
    } else if (alerts.some(a => a.includes('WARNING'))) {
      await sendTelegramAlert(
        `⚠️ <b>VIXOL Server 2 Warning</b>\n\n` +
        `${alertMessage}\n\n` +
        `Server health: ${health}%`
      );
    }
  }
  
  // Save to log
  const logEntry = JSON.stringify(status) + '\n';
  fs.appendFileSync(LOG_FILE, logEntry);
  
  return status;
}

// ============ API ENDPOINT SUPPORT ============

/**
 * Get current capacity status (for API calls)
 */
function getCapacityStatus() {
  try {
    if (fs.existsSync(STATUS_FILE)) {
      return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'));
    }
    return null;
  } catch (error) {
    console.error('Failed to read capacity status:', error);
    return null;
  }
}

// ============ RUN ============

if (require.main === module) {
  // Create log file if needed
  if (!fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, '');
  }
  
  // Run check
  checkCapacity().then(() => {
    console.log('✅ Capacity check complete\n');
  }).catch(error => {
    console.error('❌ Capacity check failed:', error);
    process.exit(1);
  });
}

module.exports = {
  checkCapacity,
  getCapacityStatus,
  getRamUsage,
  getDiskUsage,
  getDbConnections,
  getActiveUsers,
  getQueryThroughput,
  shouldAllowNewSignups,
  getServerHealth,
};
