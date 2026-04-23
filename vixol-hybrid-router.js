/**
 * VIXOL Hybrid Router
 * Same 4-tier logic as Token Bank, but for multi-tenant SaaS
 * 
 * Key differences:
 * - Calls remote Kimi on Server 1 (not local)
 * - Enforces user tier limits (free vs pro vs premium)
 * - Tracks per-user costs for billing
 * - Implements query quota limits
 */

const axios = require('axios');
const QueryClassifier = require('./classifier');
const config = require('./routing-config');

class VIXOLHybridRouter {
  constructor(options = {}) {
    this.classifier = new QueryClassifier();
    this.config = { ...config, ...options };
    this.stats = {
      totalQueries: 0,
      queriesByProvider: {},
      totalRevenue: 0,  // VIXOL fees
      userQueries: {},
      failedQueries: 0,
      fallbacksTriggered: 0
    };
  }

  /**
   * MAIN VIXOL ROUTING FUNCTION
   * 
   * @param {string} query - User query
   * @param {string} userId - VIXOL user ID
   * @param {string} userTier - 'free', 'pro', or 'premium'
   * @param {Object} options - Optional overrides
   * @returns {Promise<Object>} Result with cost breakdown
   */
  async route(query, userId, userTier, options = {}) {
    const startTime = Date.now();

    try {
      // Step 1: Validate user quota
      const quotaCheck = this.checkUserQuota(userId, userTier);
      if (!quotaCheck.allowed) {
        throw new Error(`User quota exceeded: ${quotaCheck.reason}`);
      }

      // Step 2: Determine provider (respecting user tier)
      let provider = await this.decideProvider(query, userTier, options);
      const originalProvider = provider;

      // Step 3: Execute query
      let result = await this.executeQuery(query, provider);

      // Step 4: Handle failures (fallback)
      if (!result.success && this.config.features.fallbackEnabled) {
        result = await this.executeFallback(query, originalProvider, userTier);
        this.stats.fallbacksTriggered++;
        provider = result.provider;
      }

      if (!result.success) {
        throw new Error(`All providers failed: ${result.error}`);
      }

      // Step 5: Calculate VIXOL fee (15% on top of cost)
      const baseCost = result.cost || 0;
      const vixolFee = baseCost * (this.config.userTiers[userTier].feePercent / 100);
      const totalCost = baseCost + vixolFee;

      // Step 6: Enrich result with billing info
      result.latency_ms = Date.now() - startTime;
      result.userId = userId;
      result.userTier = userTier;
      result.baseCost = baseCost;
      result.vixolFee = vixolFee;
      result.totalCost = totalCost;
      result.userPays = totalCost;  // What user is charged
      result.location = provider === 'kimi' ? 'remote (Server 1)' : 'cloud';

      // Step 7: Log & track
      if (this.config.features.costTracking) {
        this.logQuery(result);
      }

      // Update stats
      this.stats.totalQueries++;
      this.stats.queriesByProvider[provider] =
        (this.stats.queriesByProvider[provider] || 0) + 1;
      this.stats.totalRevenue += vixolFee;
      this.stats.userQueries[userId] = (this.stats.userQueries[userId] || 0) + 1;

      return result;
    } catch (error) {
      this.stats.failedQueries++;
      console.error(`[VIXOL] Router error: ${error.message}`);
      return {
        success: false,
        userId,
        userTier,
        error: error.message,
        baseCost: 0,
        vixolFee: 0,
        totalCost: 0
      };
    }
  }

  /**
   * CHECK USER QUOTA
   * Enforce daily/monthly limits based on tier
   */
  checkUserQuota(userId, userTier) {
    const tier = this.config.userTiers[userTier];
    if (!tier) {
      return { allowed: false, reason: `Unknown tier: ${userTier}` };
    }

    const userQueryCount = this.stats.userQueries[userId] || 0;
    if (userQueryCount >= tier.maxQueriesPerDay) {
      return { allowed: false, reason: `Daily quota exceeded (${userQueryCount}/${tier.maxQueriesPerDay})` };
    }

    return { allowed: true };
  }

  /**
   * DECISION LOGIC: Which provider?
   * Respects user tier limits
   */
  async decideProvider(query, userTier, options = {}) {
    const tier = this.config.userTiers[userTier];
    const allowedProviders = tier.allowedProviders;

    // Priority 1: Manual override (if allowed for user tier)
    if (options.forceProvider) {
      if (allowedProviders.includes(options.forceProvider)) {
        return options.forceProvider;
      } else {
        console.warn(
          `[VIXOL] ${userTier} tier not allowed to use ${options.forceProvider}`
        );
      }
    }

    // Priority 2: Auto-classification (respecting tier)
    const complexity = this.classifier.classify(query);

    // Decide ideal provider based on complexity
    let idealProvider = 'groq'; // Default
    if (complexity < this.config.thresholds.tier1) {
      idealProvider = 'kimi';
    } else if (complexity < this.config.thresholds.tier2) {
      idealProvider = 'groq';
    } else if (complexity < this.config.thresholds.tier3) {
      idealProvider = 'claude';
    } else {
      idealProvider = 'claude-opus';
    }

    // Check if allowed for user tier
    if (allowedProviders.includes(idealProvider)) {
      return idealProvider;
    }

    // Fall back to cheapest allowed provider for this tier
    for (const provider of allowedProviders) {
      return provider; // Return first allowed (cheapest)
    }

    throw new Error(`No allowed providers for ${userTier} tier`);
  }

  /**
   * EXECUTE QUERY with specific provider
   */
  async executeQuery(query, provider) {
    try {
      switch (provider) {
        case 'kimi':
          return await this.queryKimiRemote(query);
        case 'groq':
          return await this.queryGroq(query);
        case 'claude':
          return await this.queryClaude(query);
        case 'claude-opus':
          return await this.queryClaudeOpus(query);
        default:
          throw new Error(`Unknown provider: ${provider}`);
      }
    } catch (error) {
      return {
        success: false,
        provider,
        error: error.message,
        cost: 0
      };
    }
  }

  /**
   * Tier 1: Kimi K2.6 (REMOTE on Server 1)
   */
  async queryKimiRemote(query) {
    const config = this.config.providers.tier1;

    console.log(`[VIXOL] Calling remote Kimi on ${config.endpoint}`);

    const response = await axios.post(
      `${config.endpoint}/api/generate`,
      {
        model: config.model,
        prompt: query,
        stream: false,
        temperature: 0.7,
        top_p: 0.9
      },
      { timeout: config.timeout }
    );

    return {
      success: true,
      provider: 'kimi',
      location: 'remote (Server 1)',
      result: response.data.response,
      tokens_in: response.data.prompt_eval_count,
      tokens_out: response.data.eval_count,
      cost: 0.00,  // Kimi is FREE!
      quality: config.quality
    };
  }

  /**
   * Tier 2: Groq
   */
  async queryGroq(query) {
    const config = this.config.providers.tier2;

    const response = await axios.post(
      `${config.endpoint}/chat/completions`,
      {
        model: config.model,
        messages: [{ role: 'user', content: query }],
        max_tokens: 1024,
        temperature: 0.7
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: config.timeout
      }
    );

    const usage = response.data.usage;
    const cost = (usage.total_tokens / 1000000) * 0.02;

    return {
      success: true,
      provider: 'groq',
      result: response.data.choices[0].message.content,
      tokens_in: usage.prompt_tokens,
      tokens_out: usage.completion_tokens,
      cost,
      quality: config.quality
    };
  }

  /**
   * Tier 3: Claude
   */
  async queryClaude(query) {
    const config = this.config.providers.tier3;

    const response = await axios.post(
      `${config.endpoint}/messages`,
      {
        model: config.model,
        max_tokens: 1024,
        messages: [{ role: 'user', content: query }]
      },
      {
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        timeout: config.timeout
      }
    );

    const usage = response.data.usage;
    const cost = (usage.output_tokens * 0.003) / 1000 +
                 (usage.input_tokens * 0.0008) / 1000;

    return {
      success: true,
      provider: 'claude',
      result: response.data.content[0].text,
      tokens_in: usage.input_tokens,
      tokens_out: usage.output_tokens,
      cost,
      quality: config.quality
    };
  }

  /**
   * Tier 4: Claude Opus
   */
  async queryClaudeOpus(query) {
    const config = this.config.providers.tier4;

    const response = await axios.post(
      `${config.endpoint}/messages`,
      {
        model: config.model,
        max_tokens: 2048,
        messages: [{ role: 'user', content: query }]
      },
      {
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        timeout: config.timeout
      }
    );

    const usage = response.data.usage;
    const cost = (usage.output_tokens * 0.015) / 1000 +
                 (usage.input_tokens * 0.003) / 1000;

    return {
      success: true,
      provider: 'claude-opus',
      result: response.data.content[0].text,
      tokens_in: usage.input_tokens,
      tokens_out: usage.output_tokens,
      cost,
      quality: config.quality
    };
  }

  /**
   * FALLBACK: Try next provider in chain
   */
  async executeFallback(query, originalProvider, userTier) {
    const tier = this.config.userTiers[userTier];
    const allowedChain = this.config.fallbackOrder.filter(p =>
      tier.allowedProviders.includes(p)
    );

    const startIndex = allowedChain.indexOf(originalProvider) + 1;

    for (let i = startIndex; i < allowedChain.length; i++) {
      const nextProvider = allowedChain[i];
      console.log(
        `[VIXOL] Fallback: trying ${nextProvider} for user ${userTier}`
      );

      const result = await this.executeQuery(query, nextProvider);
      if (result.success) {
        return result;
      }
    }

    return {
      success: false,
      error: 'All fallback providers failed'
    };
  }

  /**
   * LOGGING
   */
  logQuery(result) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      userId: result.userId,
      userTier: result.userTier,
      provider: result.provider,
      baseCost: result.baseCost,
      vixolFee: result.vixolFee,
      totalCost: result.totalCost,
      latency_ms: result.latency_ms,
      quality: result.quality,
      location: result.location
    };

    console.log('[VIXOL QUERY]', JSON.stringify(logEntry));
  }

  /**
   * STATISTICS
   */
  getStats() {
    const total = this.stats.totalQueries;
    return {
      ...this.stats,
      queriesByProviderPercent: Object.entries(
        this.stats.queriesByProvider
      ).reduce((acc, [provider, count]) => {
        acc[provider] = `${((count / total) * 100).toFixed(1)}%`;
        return acc;
      }, {}),
      averageUserCostPerQuery: total > 0 ? (this.stats.totalRevenue / total).toFixed(4) : 0,
      thomasMonthlyRevenue: (this.stats.totalRevenue * 30).toFixed(2)  // 15% fee
    };
  }

  /**
   * USER STATISTICS
   */
  getUserStats(userId) {
    return {
      userId,
      totalQueries: this.stats.userQueries[userId] || 0,
      estimatedCost: (this.stats.userQueries[userId] || 0) * 0.0003  // Rough est.
    };
  }
}

module.exports = VIXOLHybridRouter;
