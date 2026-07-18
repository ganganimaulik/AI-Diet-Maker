/**
 * TypeScript wrapper around the shared compute-config-hash.js module.
 * The core logic lives in compute-config-hash.js so it can also be used
 * by whatsapp-worker.js via CommonJS require().
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { computeConfigHash: _computeConfigHash } = require('./compute-config-hash.js');

// Accepts plain config objects as well as hydrated mongoose documents.
export const computeConfigHash: (config: object) => string = _computeConfigHash;
