/// Path role-icon resolver. Lives in its own module so both
/// PathsPage (list cards) and PathDetail (tree header) can import
/// it without creating a PathsPage⇄PathDetail circular import.

import { briefcase } from "@base/primitives/icon/icons/briefcase";
import { smartphone } from "@base/primitives/icon/icons/smartphone";
import { cpu } from "@base/primitives/icon/icons/cpu";
import { server } from "@base/primitives/icon/icons/server";
import { blocks } from "@base/primitives/icon/icons/blocks";
import { workflow } from "@base/primitives/icon/icons/workflow";
import type { PathIconKey } from "@/data/paths";

export const PATH_ICON: Record<PathIconKey, string> = {
  briefcase,
  smartphone,
  cpu,
  server,
  blocks,
  workflow,
};
