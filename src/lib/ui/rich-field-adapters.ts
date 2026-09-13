import type { FieldDefinition } from '$lib/domain/fields';

export interface RichFieldUiAdapter {
  posterPart: string;
  mount?: (
    host: HTMLElement,
    document: unknown,
    ready: () => void,
    failed: () => void
  ) => Promise<{ dispose(): void; reset(): void }>;
}

const adapters = new Map<string, RichFieldUiAdapter>([
  [
    'impressions.logo.v1',
    {
      posterPart: 'poster',
      async mount(host, document, ready, failed) {
        const [{ mountLogoViewer }, { parseLogoDocument }] = await Promise.all([
          import('@impressions/logo/viewer'),
          import('@impressions/logo/document')
        ]);
        const parsed = parseLogoDocument(document);
        const viewer = mountLogoViewer(host, parsed, {
          interactive: true,
          rotating: false,
          onready: ready,
          onerror: failed
        });
        return { dispose: () => viewer.dispose(), reset: () => viewer.setCamera(parsed.camera) };
      }
    }
  ]
]);

export function richFieldUiAdapter(field: FieldDefinition): RichFieldUiAdapter | undefined {
  return field.presentation ? adapters.get(field.presentation.adapter) : undefined;
}
