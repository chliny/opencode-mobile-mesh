// Resolve a provider-catalog display name ("ox alpha free") for a raw model
// ID ("x-preview-f-free"), so chat UIs can label messages the way the model
// picker does instead of leaking internal IDs.

export interface ModelNameProvider {
  id: string
  models?: Array<{ id: string; name?: string }>
}

export function modelNameFor(
  providers: readonly ModelNameProvider[] | undefined | null,
  providerID: string | undefined,
  modelID: string | undefined,
): string | undefined {
  if (!providers || !modelID) return undefined

  const provider = providerID ? providers.find((p) => p.id === providerID) : undefined
  if (!provider) return undefined

  // Same modelID can exist on several providers — only trust the named one.
  // Provider missing from the catalog: fall through, callers show the raw ID.
  return provider.models?.find((m) => m.id === modelID)?.name || undefined
}
