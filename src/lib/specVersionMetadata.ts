const DATE_VERSION = /^\d{4}-\d{2}-\d{2}$/;

export const specVersionMetadata = [
  {
    version: "2026-10-23",
    href: "/specification/2026-10-23",
    openApiHref: "/openapi/2026-10-23/openapi.json",
  },
  {
    version: "2026-04-24",
    href: "/specification/2026-04-24",
    openApiHref: "/openapi/2026-04-24/openapi.json",
  },
  {
    version: "2026-01-15",
    href: "/specification/2026-01-15",
    openApiHref: "/openapi/2026-01-15/openapi.json",
  },
] as const;

export type SpecVersion = (typeof specVersionMetadata)[number]["version"];

const seenVersions = new Set<string>();
for (const release of specVersionMetadata) {
  if (!DATE_VERSION.test(release.version)) {
    throw new Error(`Invalid specification version: ${release.version}`);
  }
  if (seenVersions.has(release.version)) {
    throw new Error(`Duplicate specification version: ${release.version}`);
  }
  seenVersions.add(release.version);
}

export const findSpecVersionMetadata = (version: string) =>
  specVersionMetadata.find((release) => release.version === version);

export const currentSpecVersionMetadata = specVersionMetadata[0];
