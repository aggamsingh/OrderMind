/**
 * serializeError — turn whatever was thrown into something an audit row can
 * actually be read from.
 *
 * Razorpay's Node SDK throws plain objects shaped like
 * { statusCode, error: { code, description, ... } }, not Error instances.
 * `err.message` on those is undefined and `String(err)` produces the useless
 * "[object Object]" — which this project has now been bitten by twice: once
 * on the human order path (BUILD_LOG.md Day 3), and again on the agent order
 * path, where the fix had been reimplemented by hand and lost the lesson.
 *
 * It lives in its own module precisely so the next code path that catches a
 * Razorpay failure reuses it rather than rewriting a worse version. An audit
 * trail that records "[object Object]" for a failed money movement is, for
 * debugging purposes, no audit trail at all.
 */
export function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) return { message: err.message, name: err.name };
  if (typeof err === "object" && err !== null) return err as Record<string, unknown>;
  return { raw: String(err) };
}
