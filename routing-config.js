/**
 * VIXOL Routing Configuration
 * Same logic as Token Bank, but calls remote Kimi on Server 1
 */

module.exports = {
  // Complexity thresholds (0.0-1.0)
  thresholds: {
    tier1: 0.2,  // < 0.2: Kimi (simple)
    tier2: 0.5,  // 0.2-0.5: Groq (medium)
    tier3: 0.8   // 0.5-0.8: Claude (complex)
    // >= 0.8: Claude Opus (expert)
  },

  // Provider configuration per tier
  providers: {
    tier1: {
      name: 'llama2',
      endpoint: 'http://100.101.90.46:11434',  // ← Remote Server 1!
      model: 'llama2:7b',
      timeout: 15000,  // Allow extra latency for network
      cost: 0.00,
      quality: 7.5,
      location: 'remote (Server 1)'
    },
    tier2: {
      name: 'groq',
      endpoint: 'https://api.groq.com/openai/v1',
      model: 'llama-3.3-70b-versatile',
      timeout: 5000,
      cost: 0.0001,
      quality: 8
    },
    tier3: {
      name: 'claude',
      endpoint: 'https://api.anthropic.com/v1',
      model: 'claude-3-5-sonnet-20241022',
      timeout: 8000,
      cost: 0.002,
      quality: 9
    },
    tier4: {
      name: 'claude-opus',
      endpoint: 'https://api.anthropic.com/v1',
      model: 'claude-3-5-opus-20241022',
      timeout: 15000,
      cost: 0.03,
      quality: 10
    }
  },

  // Fallback chain (if primary fails)
  fallbackOrder: ['llama2', 'groq', 'claude', 'claude-opus'],

  // Manual overrides (per user or globally)
  overrides: {
    // Example: Free tier users only get Kimi
    // 'tier_free': { forceProvider: 'kimi' },
    
    // Example: Premium users get Claude
    // 'tier_premium': { forceProvider: 'claude' }
  },

  // VIXOL-specific: User pricing tiers
  userTiers: {
    free: {
      maxQueriesPerDay: 100,
      allowedProviders: ['llama2'],  // Only free provider
      feePercent: 15
    },
    pro: {
      maxQueriesPerDay: 10000,
      allowedProviders: ['llama2', 'groq'],  // Free + cheap
      feePercent: 15
    },
    premium: {
      maxQueriesPerDay: 100000,
      allowedProviders: ['llama2', 'groq', 'claude', 'claude-opus'],  // All!
      feePercent: 15
    }
  },

  // Logging & monitoring
  logging: {
    enabled: true,
    logPath: '/var/log/vixol-routing.log',
    logLevel: 'info'
  },

  // Feature flags
  features: {
    autoRouting: true,
    manualOverride: true,
    fallbackEnabled: true,
    cachingEnabled: true,
    costTracking: true,
    userTierEnforcement: true  // Enforce user tier limits
  }
};
