/**
 * Host half of the bundle. It provides no Host capability: the Loader row exists
 * so the Client module scan can find this package's `dsh.client` declaration, and
 * the browser half owns everything the user sees.
 */
export function apply() {}
