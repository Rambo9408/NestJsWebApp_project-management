/**
 * Barrel export for the configuration module.
 *
 * Why barrels? They let consumers write `from 'src/config'` instead of reaching
 * into internal file paths, which keeps a module free to reorganise its own
 * files without breaking every importer. Use them for a module public API;
 * avoid deep barrels that re-export everything from everywhere, because those
 * create import cycles (a real cause of the circular-dependency pain we cover
 * in Phase 4).
 */
export * from './app-config.service';
export * from './config.module';
export * from './config.types';
export * from './namespaces';
