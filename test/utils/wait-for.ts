/** Retries `check` until it stops throwing; rethrows its last error on timeout. */
export async function waitFor<T>(
  check: () => T | Promise<T>,
  { timeoutMs = 5000, intervalMs = 50 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await check();
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}
