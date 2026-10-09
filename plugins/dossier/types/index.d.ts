export type DossierWave = { slug: string; text: string; milestone?: string }

declare module 'claude-code' {
  interface PluginState {
    dossier: { wave: DossierWave | null }
  }
}
