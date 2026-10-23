import Specification20260115 from "../specifications/2026-01-15.mdx";
import Specification20260424 from "../specifications/2026-04-24.mdx";
import Specification20261023 from "../specifications/2026-10-23.mdx";
import { specVersionMetadata } from "./specVersionMetadata";

const contentByVersion = {
  "2026-10-23": Specification20261023,
  "2026-04-24": Specification20260424,
  "2026-01-15": Specification20260115,
} satisfies Record<(typeof specVersionMetadata)[number]["version"], unknown>;

export const specVersions = specVersionMetadata.map((release) => ({
  ...release,
  Content: contentByVersion[release.version],
}));

export const currentSpecVersion = specVersions[0];

export const findSpecVersion = (version: string) =>
  specVersions.find((release) => release.version === version);
