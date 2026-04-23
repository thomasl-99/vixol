/**
 * VIXOL Capacity Middleware
 * 
 * Prevents new user signups when server capacity is exceeded
 * Used in Express.js routes
 */

const fs = require('fs');

const STATUS_FILE = '/tmp/vixol-capacity-status.json';

/**
 * Get current capacity status
 */
function getCapacityStatus() {
  try {
    if (fs.existsSync(STATUS_FILE)) {
      return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'));
    }
    return null;
  } catch (error) {
    console.error('❌ Failed to read capacity status:', error);
    return null;
  }
}

/**
 * Middleware: Check if new signups are allowed
 */
const checkCapacityForSignup = (req, res, next) => {
  const status = getCapacityStatus();
  
  if (!status) {
    // If we can't read status, allow signup (safer default)
    console.warn('⚠️ Capacity status unavailable, allowing signup');
    return next();
  }
  
  const { allow_new_signups, health_percentage } = status;
  
  if (!allow_new_signups) {
    console.warn(`🛑 SIGNUP BLOCKED: Server capacity exceeded (health: ${health_percentage}%)`);
    
    return res.status(503).json({
      error: 'Service temporarily unavailable',
      message: 'Server capacity reached. Please try again later.',
      reason: 'capacity_limit',
      server_health: health_percentage,
      support_email: 'hello@vixol.cloud'
    });
  }
  
  next();
};

/**
 * Middleware: Check rate limiting + capacity together
 */
const checkCapacityForQuery = (req, res, next) => {
  const status = getCapacityStatus();
  
  if (!status) {
    return next();
  }
  
  const { health_percentage } = status;
  
  // If health < 20%, start rejecting some queries (random backoff)
  if (health_percentage < 20) {
    const shouldReject = Math.random() < (1 - (health_percentage / 100));
    
    if (shouldReject) {
      console.warn(`⚠️ QUERY REJECTED: Server overloaded (health: ${health_percentage}%)`);
      return res.status(503).json({
        error: 'Server overloaded',
        message: 'Server is under heavy load. Please retry.',
        retry_after: Math.ceil(Math.random() * 5) + 1,
        server_health: health_percentage
      });
    }
  }
  
  next();
};

/**
 * Express.js route wrapper for signup endpoint
 * Usage: app.post('/api/signup', checkCapacityForSignup, signupHandler);
 */
const blockSignupsWhenFull = (req, res, next) => {
  return checkCapacityForSignup(req, res, next);
};

/**
 * Get capacity status (for API calls)
 * Usage: app.get('/api/capacity', capacityStatusRoute);
 */
const capacityStatusRoute = (req, res) => {
  const status = getCapacityStatus();
  
  if (!status) {
    return res.status(503).json({
      error: 'Capacity monitor not available',
      message: 'Please try again in a moment'
    });
  }
  
  res.json({
    server_health: status.health_percentage,
    allow_new_signups: status.allow_new_signups,
    capacity: {
      ram: status.ram,
      disk: status.disk,
      database: status.db,
      users: status.users,
      throughput: status.throughput
    },
    timestamp: status.timestamp
  });
};

/**
 * Alert message format
 */
function formatCapacityAlert(status) {
  return `
🚨 VIXOL SERVER 2 CAPACITY ALERT

Ram:        ${status.ram?.percentage}% (${status.ram?.status})
Disk:       ${status.disk?.percentage}% (${status.disk?.status})
DB Conns:   ${status.db?.percentage}% (${status.db?.status})
Users:      ${status.users?.percentage}% (${status.users?.status})

Server Health: ${status.health_percentage}%
Signups: ${status.allow_new_signups ? '✅ ALLOWED' : '❌ BLOCKED'}

⏱️ Action required when capacity critical!
Contact: hello@vixol.cloud
  `.trim();
}

module.exports = {
  checkCapacityForSignup,
  checkCapacityForQuery,
  blockSignupsWhenFull,
  capacityStatusRoute,
  getCapacityStatus,
  formatCapacityAlert,
};
