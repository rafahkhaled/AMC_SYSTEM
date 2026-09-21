/**
 * An environment variable set to nothing is a variable that is not set.
 *
 * Compose writes `FOO: ${FOO:-}` for everything optional, which puts `FOO=`
 * into the container rather than leaving it out. To the process that is an
 * empty string, and an empty string is not the same as absent to a schema:
 *
 *  - `z.string().email().optional()` accepts `undefined` and rejects `''`, so
 *    a practice with no mail sender got a worker that crash-looped on boot —
 *    the exact failure its own schema comment said must not happen.
 *  - `z.string().default('…')` accepts `''` as a perfectly good string, so the
 *    default never applies. The firm's Arabic name went empty and the only
 *    sign of it was a WhatsApp greeting that welcomed clients to nobody.
 *
 * The first is loud and the second is silent, which is the worse of the two.
 * Both disappear if the variables that carry nothing are dropped before the
 * schema ever sees them.
 */
export function definedOnly(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const kept: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) {
    // Whitespace too: a value that is only spaces came from a template that
    // substituted nothing, and means the same thing.
    if (value !== undefined && value.trim() !== '') kept[name] = value;
  }
  return kept;
}
