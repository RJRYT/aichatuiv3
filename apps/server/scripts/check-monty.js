import { Monty } from '@pydantic/monty/wasm';

let pool;
let session;
try {
  pool = await Monty.create({ minProcesses: 0, maxProcesses: 1, checkoutTimeout: 5 });
  session = await pool.checkout({ limits: { maxMemory: 8 * 1024 * 1024, maxFeedDurationSecs: 3 } });
  const result = await session.feedRun('40 + 2');
  if (result !== 42) throw new Error(`Unexpected Monty result: ${String(result)}`);
  console.log(`Pydantic Monty WASM ready: 40 + 2 = ${result}`);
  console.log('Node.js worker_threads are available and the WebAssembly runtime executed successfully.');
} catch (error) {
  console.error('Pydantic Monty WASM check failed:', error?.message || error);
  process.exitCode = 1;
} finally {
  if (session) await session.close().catch(() => {});
  if (pool) await pool.close().catch(() => {});
}
