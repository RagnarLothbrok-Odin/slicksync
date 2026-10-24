export interface StremioCatalog {
    extra?: { isRequired?: boolean; name: string; options?: string[] }[];
    id: string;
    name?: string;
    search?: boolean;
    type: string;
}

export type StremioResource =
    | string
    | {
          idPrefixes?: string[];
          name: string;
          types?: string[];
      };

/** Manifest extensions stay unknown until the feature using them narrows them. */
export interface StremioManifest {
    background?: string;
    behaviorHints?: {
        [key: string]: unknown;
        configurable?: boolean;
        configurationRequired?: boolean;
    };
    catalogs?: StremioCatalog[];
    description?: string;
    id: string;
    idPrefixes?: string[];
    logo?: string;
    name: string;
    resources: StremioResource[];
    types: string[];
    version: string;
    [key: string]: unknown;
}
