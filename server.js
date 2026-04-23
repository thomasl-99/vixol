/**
 * VIXOL Public Server — Server 2
 * Multi-tenant SaaS: users, auth, payments, API keys, LLM proxy, 15% fee.
 * Public-facing via nginx → 443 → 127.0.0.1:3000.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Pool } = require('pg');
const axios = require('axios');
const Stripe = require('stripe');
const path = require('path');

const PORT = parseInt(process.env.PORT || '3000');
const BIND = process.env.BIND || '127.0.0.1';
const JWT_SECRET = process.env.JWT_SECRET;
const FEE_PCT = parseFloat(process.env.FEE_PERCENTAGE || '15') / 100;

if (!JWT_SECRET) { console.error('JWT_SECRET missing'); process.exit(1); }

const pg = new Pool({ connectionString: process.env.DATABASE_URL });
const stripe = process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY !== 'sk_live_REPLACE_ME'
  ? Stripe(process.env.STRIPE_SECRET_KEY) : null;

// Langfuse
let langfuse = null;
if (process.env.LANGFUSE_ENABLED === 'true') {
  try {
    const { Langfuse } = require('langfuse');
    langfuse = new Langfuse({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      baseUrl: process.env.LANGFUSE_HOST,
    });
  } catch (e) { console.warn('Langfuse:', e.message); }
}

// Billing Router (tracks per-user costs + fees)
let BillingRouter;
try {
  BillingRouter = require('./billing-router.js');
  console.log('✅ VIXOL Billing Router: ACTIVE (per-user tracking + revenue)');
} catch (error) {
  console.warn('⚠️ Billing Router not available:', error.message);
}

// SECURITY MIDDLEWARE (Protects Anthropic API key)
const fs = require('fs');
const securityMiddleware = {
  // Rate limiting
  rateLimit: (maxRequests = 100, windowMs = 60000) => {
    const store = new Map();
    return (req, res, next) => {
      const now = Date.now();
      const key = req.userId || req.ip;
      if (!store.has(key)) store.set(key, []);
      let reqs = store.get(key).filter(t => now - t < windowMs);
      if (reqs.length >= maxRequests) {
        console.warn(`[SECURITY] Rate limit exceeded for ${key}`);
        return res.status(429).json({ error: 'Too many requests' });
      }
      reqs.push(now);
      store.set(key, reqs);
      next();
    };
  },
  
  // Request validation
  validateRequest: (req, res, next) => {
    const bodyStr = JSON.stringify(req.body || {});
    if (bodyStr.includes('sk-ant') || bodyStr.includes('ANTHROPIC')) {
      console.warn('[SECURITY] Suspicious request detected - API key pattern');
      return res.status(400).json({ error: 'Invalid request' });
    }
    next();
  },
  
  // Security headers
  securityHeaders: (req, res, next) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  },
  
  // Audit logging
  auditLog: (req, res, next) => {
    const original = res.json;
    res.json = function(data) {
      if (req.userId) {
        const log = {
          timestamp: new Date().toISOString(),
          userId: req.userId,
          endpoint: req.path,
          method: req.method,
          status: res.statusCode
        };
        fs.appendFileSync('/var/log/vixol-audit.log', JSON.stringify(log) + '\n');
      }
      return original.call(this, data);
    };
    next();
  }
};

const app = express();

// Stripe webhook moet RAW body, anderen JSON
app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// SECURITY: Apply middleware
app.use(securityMiddleware.securityHeaders);
app.use(securityMiddleware.validateRequest);
app.use(securityMiddleware.rateLimit(100, 60000)); // 100 req/min per user
app.use(securityMiddleware.auditLog);

// Trust proxy (nginx)
app.set('trust proxy', 1);

// Static files for landing page / dashboard
app.use(express.static(path.join(__dirname, 'public')));

// ============ AUTH ============

// Audit function
const audit = async (userId, action, req) => {
  const log = {
    timestamp: new Date().toISOString(),
    userId,
    action,
    ip: req.ip,
    userAgent: req.headers['user-agent']
  };
  fs.appendFileSync('/var/log/vixol-security.log', JSON.stringify(log) + '\n');
};

app.post('/api/signup', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: 'Invalid input (password >= 8 chars)' });
  }
  try {
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pg.query(
      `INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email`,
      [email.toLowerCase(), hash, name || null]
    );
    await pg.query(`INSERT INTO user_balances (user_id, balance_eur) VALUES ($1, 0)`, [rows[0].id]);
    await audit(rows[0].id, 'signup', req);
    const token = jwt.sign({ userId: rows[0].id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ user: rows[0], token });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already exists' });
    console.error(err);
    res.status(500).json({ error: 'signup failed' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const { rows } = await pg.query(`SELECT * FROM users WHERE email = $1 AND status = 'active'`, [email.toLowerCase()]);
  if (!rows.length) return res.status(401).json({ error: 'invalid credentials' });
  const ok = await bcrypt.compare(password, rows[0].password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });
  await pg.query(`UPDATE users SET last_login = NOW() WHERE id = $1`, [rows[0].id]);
  await audit(rows[0].id, 'login', req);
  const token = jwt.sign({ userId: rows[0].id }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ user: { id: rows[0].id, email: rows[0].email, name: rows[0].name, plan: rows[0].plan }, token });
});

function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch { res.status(401).json({ error: 'invalid token' }); }
}

// API key auth (for SDK requests with vxl_ keys)
async function requireApiKey(req, res, next) {
  const auth = req.headers.authorization || '';
  const apiKey = auth.replace(/^Bearer\s+/i, '');
  if (!apiKey.startsWith('vxl_')) return res.status(401).json({ error: 'invalid api key' });
  const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const { rows } = await pg.query(
    `SELECT k.*, u.id AS user_id_ref, u.status, b.balance_eur
     FROM user_api_keys k
     JOIN users u ON u.id = k.user_id
     LEFT JOIN user_balances b ON b.user_id = u.id
     WHERE k.key_hash = $1 AND k.revoked_at IS NULL AND u.status = 'active'`,
    [hash]
  );
  if (!rows.length) return res.status(401).json({ error: 'invalid api key' });
  if (parseFloat(rows[0].balance_eur || 0) < 0.001) {
    return res.status(402).json({ error: 'insufficient balance — top up at vixol.cloud' });
  }
  req.apiKeyId = rows[0].id;
  req.userId = rows[0].user_id_ref;
  req.balance = parseFloat(rows[0].balance_eur || 0);
  await pg.query(`UPDATE user_api_keys SET last_used_at = NOW() WHERE id = $1`, [rows[0].id]);
  next();
}

// ============ API KEYS ============

app.post('/api/keys', requireAuth, async (req, res) => {
  const { name } = req.body;
  const fullKey = 'vxl_live_' + crypto.randomBytes(24).toString('hex');
  const prefix = fullKey.substring(0, 16);
  const hash = crypto.createHash('sha256').update(fullKey).digest('hex');
  const { rows } = await pg.query(
    `INSERT INTO user_api_keys (user_id, key_prefix, key_hash, name) VALUES ($1, $2, $3, $4) RETURNING id, key_prefix, name, created_at`,
    [req.userId, prefix, hash, name || 'default']
  );
  await audit(req.userId, 'api_key_created', req);
  // Return full key ONLY ON CREATE (never again)
  res.json({ ...rows[0], key: fullKey, warning: 'Save this key — you cannot see it again' });
});

app.get('/api/keys', requireAuth, async (req, res) => {
  const { rows } = await pg.query(
    `SELECT id, key_prefix, name, last_used_at, created_at, revoked_at
     FROM user_api_keys WHERE user_id = $1 ORDER BY id DESC`,
    [req.userId]
  );
  res.json(rows);
});

// ============ LLM PROXY (earn fee) ============

app.post('/api/v1/query', requireApiKey, async (req, res) => {
  const start = Date.now();
  const { prompt, maxTokens = 1024, forceProvider } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  try {
    // UPDATED: Use Billing Router for per-user tracking + revenue
    if (BillingRouter) {
      try {
        const result = await BillingRouter.handleQuery(req.userId, prompt, 'auto', { maxTokens, forceProvider });
        
        // Deduct from user balance
        await pg.query(
          `UPDATE user_balances SET balance_eur = balance_eur - $1, updated_at = NOW() WHERE user_id = $2`,
          [result.userPays, req.userId]
        );
        
        // Log to database
        await pg.query(
          `INSERT INTO usage_log (user_id, api_key_id, provider, cost_eur, price_eur, fee_eur, latency_ms)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [req.userId, req.apiKeyId, result.provider, result.cost, result.userPays, result.fee, result.latency]
        );
        
        return res.json({
          response: result.response,
          provider: result.provider,
          cost_eur: result.cost,
          you_pay_eur: result.userPays,
          thomas_earns_eur: result.fee,
          latency_ms: result.latency
        });
      } catch (billingError) {
        console.warn('[VIXOL] Billing router failed, falling back to direct routing:', billingError.message);
      }
    }
    
    // Fallback: Simple classification (voor smart routing)
    const isSimple = prompt.length < 500 && !/\b(analyze|design|explain reasoning|complex)\b/i.test(prompt);
    const provider = forceProvider || (isSimple ? 'groq' : 'anthropic');

    let result, tokensIn = 0, tokensOut = 0, costEur = 0;
    if (provider === 'groq') {
      const r = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
        model: 'llama-3.3-70b-versatile', max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }, { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` }, timeout: 30000 });
      result = r.data.choices[0].message.content;
      tokensIn = r.data.usage?.prompt_tokens || 0;
      tokensOut = r.data.usage?.completion_tokens || 0;
      costEur = (tokensIn * 0.59 + tokensOut * 0.79) / 1_000_000;
    } else {
      const r = await axios.post('https://api.anthropic.com/v1/messages', {
        model: 'claude-haiku-4-5', max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }, {
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        timeout: 60000,
      });
      result = r.data.content[0].text;
      tokensIn = r.data.usage?.input_tokens || 0;
      tokensOut = r.data.usage?.output_tokens || 0;
      costEur = (tokensIn * 1.00 + tokensOut * 5.00) / 1_000_000;
    }

    // Fee calculation: user prijs = cost * (1 + fee_pct)
    const priceEur = costEur * (1 + FEE_PCT);
    const feeEur = priceEur - costEur;
    const latencyMs = Date.now() - start;

    // Deduct from balance
    await pg.query(
      `UPDATE user_balances SET balance_eur = balance_eur - $1, updated_at = NOW() WHERE user_id = $2`,
      [priceEur, req.userId]
    );

    // Log usage
    await pg.query(
      `INSERT INTO usage_log (user_id, api_key_id, provider, tokens_in, tokens_out, cost_eur, price_eur, fee_eur, latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [req.userId, req.apiKeyId, provider, tokensIn, tokensOut, costEur, priceEur, feeEur, latencyMs]
    );

    res.json({
      result, provider,
      tokens: { in: tokensIn, out: tokensOut },
      cost: { price_eur: priceEur, fee_eur: feeEur, currency: 'EUR' },
      balance_remaining: req.balance - priceEur,
    });
  } catch (err) {
    console.error('Query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============ BILLING (Stripe) ============

app.post('/api/payments/topup', requireAuth, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'stripe not configured' });
  const { amountEur } = req.body;
  if (!amountEur || amountEur < 5) return res.status(400).json({ error: 'min €5' });

  const pi = await stripe.paymentIntents.create({
    amount: Math.round(amountEur * 100),
    currency: 'eur',
    metadata: { user_id: String(req.userId) },
  });
  res.json({ clientSecret: pi.client_secret, paymentIntentId: pi.id });
});

app.post('/api/webhooks/stripe', async (req, res) => {
  if (!stripe) return res.status(503).send('disabled');
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) { return res.status(400).send(`Webhook Error: ${err.message}`); }

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object;
    const userId = parseInt(pi.metadata.user_id);
    const amount = pi.amount / 100;
    await pg.query(
      `INSERT INTO payments (user_id, stripe_payment_intent, amount_eur, status) VALUES ($1, $2, $3, 'succeeded')
       ON CONFLICT (stripe_payment_intent) DO NOTHING`,
      [userId, pi.id, amount]
    );
    await pg.query(`UPDATE user_balances SET balance_eur = balance_eur + $1 WHERE user_id = $2`, [amount, userId]);
    await audit(userId, 'payment_succeeded', req, { amount });
  }
  res.json({ received: true });
});

// ============ USER DASHBOARD ============

app.get('/api/me', requireAuth, async (req, res) => {
  const { rows } = await pg.query(
    `SELECT u.id, u.email, u.name, u.plan, u.created_at, b.balance_eur
     FROM users u LEFT JOIN user_balances b ON b.user_id = u.id WHERE u.id = $1`,
    [req.userId]
  );
  res.json(rows[0]);
});

app.get('/api/me/stats', requireAuth, async (req, res) => {
  const stats = await pg.query(`
    SELECT
      COUNT(*) AS total_calls,
      SUM(tokens_in + tokens_out) AS total_tokens,
      SUM(price_eur) AS spent_eur,
      SUM(fee_eur) AS fees_paid
    FROM usage_log WHERE user_id = $1 AND created_at > NOW() - INTERVAL '30 days'
  `, [req.userId]);
  res.json(stats.rows[0]);
});

// ============ HEALTH ============

app.get('/api/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// Helper
async function audit(userId, action, req, detail = null) {
  try {
    await pg.query(
      `INSERT INTO audit_log (user_id, action, ip_address, user_agent, detail) VALUES ($1, $2, $3, $4, $5)`,
      [userId, action, req.ip, req.headers['user-agent'] || null, detail]
    );
  } catch {}
}

app.listen(PORT, BIND, () => {
  console.log(`✅ VIXOL Public running on ${BIND}:${PORT} (fee: ${FEE_PCT * 100}%)`);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  if (langfuse) await langfuse.shutdownAsync().catch(() => {});
  await pg.end();
  process.exit(0);
});
