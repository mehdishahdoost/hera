export type ProviderName = string;

export interface RunRequest {
  model: string;
  prompt: string;
  cwd: string;
  sessionName: string;
  scheduled?: boolean;
  onChildSpawn?: (pid: number) => Promise<void>;
}

export interface ProviderResult { exitCode: number; }
export interface ModelInfo { id: string; name: string; }
export interface PluginInstallRequest { path: string; }
export interface PluginInfo {
  provider: string; name: string; version?: string; sourcePath: string;
  installedAt: string; providerId: string;
}
export interface Provider {
  name: ProviderName;
  run(request: RunRequest, emit: (stream: "stdout" | "stderr", text: string) => Promise<void>, onChildSpawn?: (pid: number) => Promise<void>): Promise<ProviderResult>;
  listModels(): Promise<ModelInfo[]>;
  installPlugin(request: PluginInstallRequest): Promise<PluginInfo>;
}

export interface Schedule {
  name: string; provider: string; model: string; prompt: string; cron: string;
  cwd: string; timeZone: string; createdAt: string;
}
