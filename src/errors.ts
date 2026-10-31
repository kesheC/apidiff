/**
 * An error the user can fix by changing the invocation or the input files.
 *
 * The CLI maps it onto exit code 2 and a one-line message instead of a stack
 * trace. It lives here rather than in cli.ts so the library can throw it too:
 * `diffDetect` rejects a mixed pair of documents, and a caller that imported
 * only the library still gets a typed, catchable error.
 */
export class UsageError extends Error {
  override readonly name = "UsageError";
}
