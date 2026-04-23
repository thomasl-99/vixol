# VIXOL — Intelligent LLM Cost Optimization

Save 40% on your LLM API costs with intelligent routing and automatic caching.

## What is VIXOL?

VIXOL analyzes your queries and routes them intelligently:
- **Simple queries** → Groq (€0.0001) — fast and cheap
- **Complex queries** → Claude (€0.003) — high quality reasoning
- **Repeated queries** → Cache (€0.00) — instant free responses

Result: **40% cost savings** on average, same quality.

## Installation

```bash
npm install vixol
```

## Quick Start

```javascript
const VIXOL = require('vixol');

const vixol = new VIXOL({
  apiKey: 'your-api-key-here'
});

// Simple query → routes to Groq (cheap!)
const response = await vixol.query('What is the capital of France?');
console.log(response.result); // "Paris"
console.log(response.cost); // { price_eur: 0.0001, fee_eur: 0.000015 }
```

## Features

✅ **Intelligent Routing** — Analyzes complexity, picks cheapest option
✅ **Automatic Caching** — Same query twice = free the second time
✅ **Transparent Pricing** — See exactly what you save
✅ **Zero Configuration** — Works out of the box
✅ **Open Source** — MIT licensed

## API

### `query(prompt, options)`

Send a query to VIXOL. Returns:

```javascript
{
  result: "...",           // LLM response
  provider: "groq",        // Which LLM was used
  tokens: {
    in: 47,                // Input tokens
    out: 3                 // Output tokens
  },
  cost: {
    price_eur: 0.0001,     // What you pay
    fee_eur: 0.000015,     // VIXOL fee (15%)
    currency: "EUR"
  },
  balance_remaining: 99.99  // Your account balance
}
```

### Options

- `maxTokens` (number) — Max response length (default: 1024)
- `forceProvider` (string) — Force specific LLM: "groq" or "anthropic"

## Pricing

**Free tier:** Groq-only routing, unlimited queries
**Pro:** 15% token fee, full smart routing
**Enterprise:** Custom pricing, white-label, SLA

## Get Started

1. Sign up: https://vixol.cloud
2. Create API key
3. `npm install vixol`
4. Start saving!

## Support

- GitHub: https://github.com/thomasl-99/vixol
- Issues: https://github.com/thomasl-99/vixol/issues
- Email: hello@vixol.cloud

## License

MIT
