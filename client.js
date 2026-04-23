/**
 * VIXOL Client Library
 * Intelligent LLM cost optimization
 */

const axios = require('axios');

class VIXOL {
  constructor(options = {}) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl || 'https://vixol.cloud';
  }

  async query(prompt, options = {}) {
    if (!this.apiKey) {
      throw new Error('API key required. Get one at https://vixol.cloud');
    }

    try {
      const response = await axios.post(`${this.baseUrl}/api/v1/query`, {
        prompt,
        maxTokens: options.maxTokens || 1024,
        forceProvider: options.forceProvider,
      }, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      return response.data;
    } catch (error) {
      throw new Error(`VIXOL query failed: ${error.message}`);
    }
  }

  async getBalance() {
    if (!this.apiKey) {
      throw new Error('API key required');
    }

    try {
      const response = await axios.get(`${this.baseUrl}/api/v1/balance`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });

      return response.data;
    } catch (error) {
      throw new Error(`Failed to get balance: ${error.message}`);
    }
  }
}

module.exports = VIXOL;
