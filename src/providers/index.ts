import type { Provider } from "../types.js";
import { CodexProvider } from "./codex.js";

export class ProviderRegistry {
  private readonly providers = new Map<string, Provider>();
  register(provider: Provider): void { this.providers.set(provider.name, provider); }
  get(name: string): Provider {
    const provider = this.providers.get(name);
    if (!provider) throw new Error(`Unsupported provider '${name}'. Available providers: ${[...this.providers.keys()].join(", ") || "none"}.`);
    return provider;
  }
}

export const providers = new ProviderRegistry();
providers.register(new CodexProvider());
