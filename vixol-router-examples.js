/**
 * VIXOL Router - Usage Examples
 * 
 * Shows how to use multi-tenant routing with user tiers
 */

const VIXOLHybridRouter = require('./vixol-hybrid-router');

const router = new VIXOLHybridRouter();

// ============ EXAMPLE 1: Free Tier User ============

async function freeTierExample() {
  console.log('\n=== EXAMPLE 1: Free Tier User ===\n');

  // Free users only get Kimi (cheapest for Thomas)
  const result = await router.route(
    'What is Python?',
    'user_free_001',
    'free'
  );

  console.log(`
    User: user_free_001 (FREE tier)
    Query: "What is Python?"
    
    Base cost: €${result.baseCost.toFixed(6)} (Kimi is FREE!)
    VIXOL fee (15%): €${result.vixolFee.toFixed(6)}
    User pays: €${result.totalCost.toFixed(6)} (rounded up)
    Thomas gets: €${(result.vixolFee).toFixed(6)}
    
    Provider: ${result.provider} (only option for free users)
    Latency: ${result.latency_ms}ms (4-7s for remote Kimi)
    Location: ${result.location}
  `);
}

// ============ EXAMPLE 2: Pro Tier User ============

async function proTierExample() {
  console.log('\n=== EXAMPLE 2: Pro Tier User ===\n');

  // Pro users can use Kimi + Groq
  const result = await router.route(
    'Explain quantum computing',
    'user_pro_001',
    'pro'
  );

  console.log(`
    User: user_pro_001 (PRO tier)
    Query: "Explain quantum computing"
    
    Provider auto-selected: ${result.provider}
    Base cost: €${result.baseCost.toFixed(6)}
    VIXOL fee (15%): €${result.vixolFee.toFixed(6)}
    User pays: €${result.totalCost.toFixed(6)}
    Thomas gets: €${(result.vixolFee).toFixed(6)} (profit!)
    
    Complexity: ~0.35 → Routes to Groq
    Latency: ${result.latency_ms}ms
  `);
}

// ============ EXAMPLE 3: Premium Tier User ============

async function premiumTierExample() {
  console.log('\n=== EXAMPLE 3: Premium Tier User ===\n');

  // Premium users can use any provider
  const result = await router.route(
    'Design a microservices architecture for a SaaS platform',
    'user_premium_001',
    'premium'
  );

  console.log(`
    User: user_premium_001 (PREMIUM tier)
    Query: "Design a microservices architecture..."
    
    Provider auto-selected: ${result.provider}
    Base cost: €${result.baseCost.toFixed(6)} (Claude for complex!)
    VIXOL fee (15%): €${result.vixolFee.toFixed(6)}
    User pays: €${result.totalCost.toFixed(6)} (premium price)
    Thomas gets: €${(result.vixolFee).toFixed(6)} (nice profit!)
    
    Complexity: ~0.75 → Routes to Claude
    Quality: ${result.quality}/10
    Latency: ${result.latency_ms}ms
  `);
}

// ============ EXAMPLE 4: Quota Enforcement ============

async function quotaExample() {
  console.log('\n=== EXAMPLE 4: Quota Enforcement ===\n');

  console.log('Free tier: 100 queries/day max');
  console.log('Pro tier: 10,000 queries/day max');
  console.log('Premium tier: 100,000 queries/day max');

  // Simulate user hitting quota
  for (let i = 0; i < 101; i++) {
    const result = await router.route('Test', 'user_quota_test', 'free');
    if (!result.success && i === 100) {
      console.log(`
        User: user_quota_test (FREE tier)
        Query: 101 (over limit!)
        
        ❌ Error: ${result.error}
        (User quota enforced!)
      `);
    }
  }
}

// ============ EXAMPLE 5: Revenue Tracking ============

async function revenueExample() {
  console.log('\n=== EXAMPLE 5: Revenue Tracking ===\n');

  // Simulate multiple users
  const queries = [
    { query: 'Simple', user: 'user_free_101', tier: 'free' },
    { query: 'Simple', user: 'user_pro_101', tier: 'pro' },
    { query: 'Complex', user: 'user_premium_101', tier: 'premium' },
    { query: 'Simple', user: 'user_free_102', tier: 'free' },
    { query: 'Complex', user: 'user_premium_102', tier: 'premium' },
  ];

  for (const { query, user, tier } of queries) {
    await router.route(query, user, tier);
  }

  // Get statistics
  const stats = router.getStats();
  console.log(`
    Statistics after 5 queries:
    
    Total revenue (15% fees): €${stats.totalRevenue.toFixed(4)}
    Thomas monthly revenue estimate: €${stats.thomasMonthlyRevenue}
    
    Queries by provider:
      - Kimi: ${stats.queriesByProviderPercent.kimi || '0%'} (FREE!)
      - Groq: ${stats.queriesByProviderPercent.groq || '0%'} (CHEAP)
      - Claude: ${stats.queriesByProviderPercent.claude || '0%'} (EXPENSIVE)
      - Claude-Opus: ${stats.queriesByProviderPercent['claude-opus'] || '0%'} (VERY EXPENSIVE)
    
    Average VIXOL fee per query: €${stats.averageUserCostPerQuery}
  `);
}

// ============ EXAMPLE 6: Cross-Server Kimi ============

async function crossServerExample() {
  console.log('\n=== EXAMPLE 6: Cross-Server Kimi Calls ===\n');

  console.log('Server 1 (franky-server): Ollama + Kimi running on port 11434');
  console.log('Server 2 (vixol): Routes queries to Server 1 via Tailscale');
  console.log('');
  console.log('When free user queries:');
  console.log('  1. Server 2 receives query');
  console.log('  2. Router decides: Tier 1 (Kimi)');
  console.log('  3. HTTP POST to http://100.101.90.46:11434/api/generate');
  console.log('  4. Kimi on Server 1 processes (2-5 seconds)');
  console.log('  5. Returns result (+ ~10ms network latency)');
  console.log('  6. Total: 4-7 seconds (acceptable for FREE tier!)');
  console.log('  7. Thomas charges user 15% fee on €0.00 = €0.00 profit');
  console.log('');
  console.log('Result: Users get fast response, VIXOL pays nothing, wins!');
}

// ============ EXAMPLE 7: Billing ============

async function billingExample() {
  console.log('\n=== EXAMPLE 7: Billing Breakdown ===\n');

  console.log('Scenario: 1000 VIXOL users, 1000 queries/month each');
  console.log('');

  const distribution = {
    'free': { users: 700, avgCostPerQuery: 0.00 },
    'pro': { users: 250, avgCostPerQuery: 0.00005 },
    'premium': { users: 50, avgCostPerQuery: 0.001 }
  };

  let totalRevenue = 0;

  for (const [tier, data] of Object.entries(distribution)) {
    const monthlyQueries = data.users * 1000;
    const baseCost = monthlyQueries * data.avgCostPerQuery;
    const vixolFee = baseCost * 0.15;
    const userPrice = baseCost + vixolFee;

    totalRevenue += vixolFee;

    console.log(`${tier.toUpperCase()} tier (${data.users} users):`);
    console.log(`  Monthly queries: ${monthlyQueries.toLocaleString()}`);
    console.log(`  Base cost: €${baseCost.toFixed(2)}`);
    console.log(`  VIXOL fee (15%): €${vixolFee.toFixed(2)}`);
    console.log(`  User pays: €${userPrice.toFixed(2)}`);
    console.log('');
  }

  console.log(`TOTAL MONTHLY VIXOL REVENUE: €${totalRevenue.toFixed(2)}`);
  console.log(`ESTIMATED ANNUAL: €${(totalRevenue * 12).toFixed(2)}`);
}

// ============ RUN ALL EXAMPLES ============

async function runAll() {
  try {
    await freeTierExample();
    await proTierExample();
    await premiumTierExample();
    // await quotaExample();  // Skipped (takes long)
    await revenueExample();
    await crossServerExample();
    await billingExample();
  } catch (error) {
    console.error('Error:', error.message);
  }
}

// Export for testing
module.exports = {
  freeTierExample,
  proTierExample,
  premiumTierExample,
  quotaExample,
  revenueExample,
  crossServerExample,
  billingExample,
  runAll
};

// Uncomment to run:
// runAll();
