import { getContext, setContext } from 'svelte';
import type { Catalog } from './catalog.svelte';

const CATALOG = Symbol('ongoing.catalog');

/** One catalog per shell, shared by the inventory, the fact sheets, the radar, and the palette. */
export function setCatalogContext(catalog: Catalog): Catalog {
  return setContext(CATALOG, catalog);
}

export function getCatalogContext(): Catalog {
  return getContext<Catalog>(CATALOG);
}
