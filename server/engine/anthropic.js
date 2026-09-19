// Shared Anthropic client. The key is read from the environment (server-side
// only) and never reaches the browser. Model defaults to claude-opus-4-8;
// override with FORVI_MODEL.
import Anthropic from '@anthropic-ai/sdk';

export const MODEL = process.env.FORVI_MODEL || 'claude-opus-4-8';

let instance = null;

export function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    const err = new Error('Server is missing ANTHROPIC_API_KEY. Add it to server .env.');
    err.code = 'NO_API_KEY';
    throw err;
  }
  if (!instance) instance = new Anthropic();
  return instance;
}
