/**
 * VIXOL Billing Router
 * 
 * Handles:
 * 1. Per-user quota checking
 * 2. Token Bank routing
 * 3. Cost logging to database
 * 4. Usage tracking
 * 5. Billing calculation (15% fee)
 */

const axios = require('axios');
const fs = require('fs');

class VIXOLBillingRouter {
  constructor() {
    this.tokenBankUrl = 'http://localhost:3300';
    this.logFile = '/var/log/vixol-billing.log';
    this.statsFile = '/opt/vixol-public/vixol-billing-stats.json';
    this.ensureFiles();
    
    console.log('💳 VIXOL Billing Router INITIALIZED');
    console.log('   Per-user tracking: ACTIVE');
    console.log('   Billing calculation: ACTIVE');
    console.log('   Revenue tracking: ACTIVE');
  }

  ensureFiles() {
    if (!fs.existsSync(this.logFile)) {
      fs.writeFileSync(this.logFile, '', { flag: 'w' });
    }
    if (!fs.existsSync(this.statsFile)) {
      fs.writeFileSync(this.statsFile, JSON.stringify({
        totalQueries: 0,
        totalCost: 0,
        totalRevenue: 0,
        byTier: { tier1: 0, tier2: 0, tier3: 0, tier4: 0 },
        byUser: {},
        startTime: new Date().toISOString()
      }, null, 2));
    }
  }

  /**
   * MAIN: Handle user query with billing
   */
  async handleQuery(userId, query, model, options = {}) {
    const startTime = Date.now();

    try {
      // Step 1: Check quota
      const user = await this.checkQuota(userId);
      
      // Step 2: Call Token Bank
      const result = await this.callTokenBank(query, model, options);
      
      // Step 3: Calculate billing
      const billing = this.calculateBilling(result.cost);
      
      // Step 4: Log to file
      this.logQuery(userId, {
        query: query.substring(0, 100),
        provider: result.provider,
        tier: result.tier,
        cost: result.cost,
        fee: billing.fee,
        latency: Date.now() - startTime
      });
      
      // Step 5: Update stats
      this.updateStats(userId, result, billing);
      
      return {
        response: result.response,
        cost: result.cost,
        fee: billing.fee,
        userPays: billing.userPays,
        thomasEarns: billing.fee,
        latency: Date.now() - startTime
      };
    } catch (error) {
      console.error(`[VIXOL-BILLING] Error: ${error.message}`);
      this.logQuery(userId, {
        query: query.substring(0, 100),
        error: error.message,
        status: 'error'
      });
      throw error;
    }
  }

  /**
   * Check user quota
   */
  async checkQuota(userId) {
    // In production: fetch from database
    // For now: simple in-memory check
    
    const userTiers = {
      'free': { queriesPerDay: 100 },
      'pro': { queriesPerDay: 10000 },
      'premium': { queriesPerDay: 100000 }
    };
    
    // Default: free tier
    return {
      userId,
      tier: 'free',
      queriesPerDay: userTiers['free'].queriesPerDay,
      queriesUsed: 0
    };
  }

  /**
   * Call Token Bank router
   */
  async callTokenBank(query, model, options) {
    try {
      const response = await axios.post(
        `${this.tokenBankUrl}/route`,
        {
          query,
          model,
          userId: 'vixol',
          forceProvider: options.forceProvider || null
        },
        { timeout: 60000 }
      );

      return response.data;
    } catch (error) {
      console.error(`[VIXOL] Token Bank error: ${error.message}`);
      throw new Error(`Token Bank unavailable: ${error.message}`);
    }
  }

  /**
   * Calculate billing (15% fee)
   */
  calculateBilling(cost) {
    const fee = cost * 0.15;  // 15% of provider cost
    const userPays = cost + fee;
    
    return {
      cost,
      fee,
      userPays,
      thomasEarns: fee
    };
  }

  /**
   * Log query to file
   */
  logQuery(userId, data) {
    const logLine = JSON.stringify({
      timestamp: new Date().toISOString(),
      userId,
      ...data
    }) + '\n';
    
    fs.appendFileSync(this.logFile, logLine);
  }

  /**
   * Update statistics
   */
  updateStats(userId, result, billing) {
    try {
      const stats = JSON.parse(fs.readFileSync(this.statsFile, 'utf8'));
      
      stats.totalQueries++;
      stats.totalCost += result.cost;
      stats.totalRevenue += billing.fee;
      
      // By tier
      stats.byTier[result.tier] = (stats.byTier[result.tier] || 0) + 1;
      
      // By user
      if (!stats.byUser[userId]) {
        stats.byUser[userId] = {
          queriesCount: 0,
          totalCost: 0,
          totalFee: 0
        };
      }
      stats.byUser[userId].queriesCount++;
      stats.byUser[userId].totalCost += result.cost;
      stats.byUser[userId].totalFee += billing.fee;
      
      fs.writeFileSync(this.statsFile, JSON.stringify(stats, null, 2));
    } catch (error) {
      console.warn('[VIXOL-BILLING] Stats update failed:', error.message);
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    try {
      return JSON.parse(fs.readFileSync(this.statsFile, 'utf8'));
    } catch {
      return null;
    }
  }

  /**
   * Get user billing
   */
  getUserBilling(userId) {
    try {
      const stats = this.getStats();
      return stats.byUser[userId] || null;
    } catch {
      return null;
    }
  }
}

module.exports = new VIXOLBillingRouter();
