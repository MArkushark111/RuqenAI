/**
 * API Key Store and credentials helper for Ruqenai.
 */

import { configManager } from './settings.js';
import { ProviderCatalog } from '../providers/catalog.js';

export class KeyStore {
  public static getKey(providerId: string): string | undefined {
    if (providerId === 'ollama') return undefined;
    return configManager.getApiKey(providerId, ProviderCatalog.get(providerId)?.envKey);
  }

  public static setKey(providerId: string, key: string): void {
    configManager.setApiKey(providerId, key);
  }

  public static removeKey(providerId: string): void {
    configManager.removeApiKey(providerId);
  }

  public static listConfigured(): Record<string, string> {
    return Object.fromEntries(ProviderCatalog.all()
      .filter(({ id }) => ProviderCatalog.connection(id) !== 'catalog' && KeyStore.getKey(id))
      .map(({ id }) => [id, '[configured]']));
  }
}
