import tide from './assets/battlefield-tide.svg';
import grove from './assets/battlefield-grove.svg';
import harbor from './assets/battlefield-harbor.svg';
import type { CardDefinition } from '@rb-unbound/tabletop';

const art: Record<string, string> = { tide, grove, harbor };

export function battlefieldArt(card?: CardDefinition): string | undefined {
  return card?.metadata.slot === 'battlefields' && typeof card.metadata.image === 'string'
    ? art[card.metadata.image] : undefined;
}
