/**
 * The injection token, alone in its own file.
 *
 * It lived in `storage.module.ts`, which imports the controller, which needs
 * the token — a cycle. TypeScript compiles it happily; at boot the module
 * evaluates first and reads a `const` that is still in its temporal dead
 * zone, and the process dies with "Cannot access 'FILE_STORAGE' before
 * initialization". A token has no dependencies, so it belongs where nothing
 * has to import a module to reach it.
 */
export const FILE_STORAGE = Symbol('FILE_STORAGE');
