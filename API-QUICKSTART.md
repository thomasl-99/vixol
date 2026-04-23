# VIXOL API Quickstart

Welcome to VIXOL — 40% cheaper LLM API calls via intelligent routing.

## 1. Create Account

```bash
curl -X POST https://vixol.cloud/api/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "your@email.com",
    "password": "yourpassword",
    "name": "Your Name"
  }'

# Response:
{
  "user": { "id": 123, "email": "your@email.com" },
  "token": "eyJhbGc..."
}
```

Save the `token` for next steps.

---

## 2. Create API Key

```bash
curl -X POST https://vixol.cloud/api/keys \
  -H "Authorization: Bearer eyJhbGc..." \
  -d '{"name": "My First Key"}'

# Response:
{
  "id": "key_123",
  "key_prefix": "vxl_live_abc",
  "key": "vxl_live_abcdef1234567890...",  # ← SAVE THIS!
  "warning": "Save this key — you cannot see it again"
}
```

Your API key is now active. **You'll need this for all API calls.**

---

## 3. Top Up Balance

First, you need credits. Top up via Stripe:

```bash
curl -X POST https://vixol.cloud/api/payments/topup \
  -H "Authorization: Bearer eyJhbGc..." \
  -H "Content-Type: application/json" \
  -d '{"amountEur": 10}'

# Response:
{
  "clientSecret": "pi_1234...",
  "paymentIntentId": "pi_1234..."
}
```

Complete payment via Stripe modal (clientSecret), then you'll have €10 in credits.

---

## 4. Make Your First Query

```bash
curl -X POST https://api.vixol.cloud/api/v1/query \
  -H "Authorization: Bearer vxl_live_abcdef1234567890..." \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "What is 2+2?",
    "maxTokens": 100
  }'

# Response:
{
  "result": "2 + 2 = 4",
  "provider": "groq",
  "tokens": { "in": 8, "out": 5 },
  "cost": {
    "price_eur": 0.000042,
    "fee_eur": 0.000006,
    "currency": "EUR"
  },
  "balance_remaining": 9.999958
}
```

**That's it!** Simple queries go to Groq (fast + cheap), complex ones to Claude (accurate).

---

## 5. Check Your Usage

```bash
curl https://vixol.cloud/api/me/stats \
  -H "Authorization: Bearer eyJhbGc..."

# Response:
{
  "total_calls": 42,
  "total_tokens": 12450,
  "spent_eur": 0.52,
  "fees_paid": 0.09
}
```

---

## 6. SDK Examples

### Python
```python
import requests

API_KEY = "vxl_live_..."

response = requests.post(
  "https://api.vixol.cloud/api/v1/query",
  headers={"Authorization": f"Bearer {API_KEY}"},
  json={
    "prompt": "Explain quantum computing in 100 words",
    "maxTokens": 200
  }
)

print(response.json()["result"])
print(f"Cost: €{response.json()['cost']['price_eur']}")
```

### JavaScript
```javascript
const API_KEY = "vxl_live_...";

const response = await fetch("https://api.vixol.cloud/api/v1/query", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${API_KEY}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    prompt: "What is the capital of France?",
    maxTokens: 50
  })
});

const data = await response.json();
console.log(data.result);
console.log(`Saved: €${(data.cost.fee_eur).toFixed(4)}`);
```

---

## 7. Cost Breakdown

VIXOL charges a **15% fee on savings**:

- Claude Haiku: €1/1M input, €5/1M output
- Groq Llama: €0.59/1M input, €0.79/1M output

**Example:**
- Your prompt → Groq = €0.0005 (cost)
- You pay = €0.0005 + (15% of Anthropic savings) = €0.00065
- **You save vs Claude: 80%**

---

## 8. Rate Limits

- **Auth:** 5 requests/min (login/signup)
- **Signup:** 3 per hour
- **API calls:** 30 per second
- **Burst:** 50 concurrent

---

## 9. Error Codes

| Code | Meaning |
|---|---|
| 401 | Invalid API key |
| 402 | Insufficient balance |
| 429 | Rate limited |
| 500 | Server error |

---

## 10. Dashboard

Visit https://vixol.cloud after signup to:
- View your API keys
- Check usage & costs
- See savings
- Manage billing

---

**Need help?** Email support@vixol.cloud or check https://docs.vixol.cloud
