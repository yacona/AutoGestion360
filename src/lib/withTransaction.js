const db = require('../../db');

/**
 * Runs `fn(client)` inside a BEGIN/COMMIT block.
 * Automatically rolls back and releases the client on error.
 */
async function withTransaction(fn) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = withTransaction;
