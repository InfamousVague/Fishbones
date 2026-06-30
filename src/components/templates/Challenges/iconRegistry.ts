// Eager-import every lucide icon `iconForSkill` can return. Using a
// static map keeps the bundler's dead-code path predictable — only
// the icons listed below ship in the chunk that loads with the
// Trees view, regardless of which trees the learner explores.
import { box } from "@base/primitives/icon/icons/box";
import { calculator } from "@base/primitives/icon/icons/calculator";
import { quote } from "@base/primitives/icon/icons/quote";
import { toggleLeft } from "@base/primitives/icon/icons/toggle-left";
import { equal } from "@base/primitives/icon/icons/equal";
import { gitBranch } from "@base/primitives/icon/icons/git-branch";
import { repeat } from "@base/primitives/icon/icons/repeat";
import { parentheses } from "@base/primitives/icon/icons/parentheses";
import { cornerDownLeft } from "@base/primitives/icon/icons/corner-down-left";
import { list } from "@base/primitives/icon/icons/list";
import { iconPackage as packageIcon } from "@base/primitives/icon/icons/package";
import { layers } from "@base/primitives/icon/icons/layers";
import { infinity as infinityIcon } from "@base/primitives/icon/icons/infinity";
import { alertTriangle } from "@base/primitives/icon/icons/alert-triangle";
import { terminal } from "@base/primitives/icon/icons/terminal";
import { fileText } from "@base/primitives/icon/icons/file-text";
import { checkCircle } from "@base/primitives/icon/icons/check-circle";
import { code as codeIcon } from "@base/primitives/icon/icons/code";
import { palette } from "@base/primitives/icon/icons/palette";
import { mousePointer2 } from "@base/primitives/icon/icons/mouse-pointer-2";
import { zap } from "@base/primitives/icon/icons/zap";
import { download } from "@base/primitives/icon/icons/download";
import { hourglass } from "@base/primitives/icon/icons/hourglass";
import { atom } from "@base/primitives/icon/icons/atom";
import { route } from "@base/primitives/icon/icons/route";
import { type as typeIcon } from "@base/primitives/icon/icons/type";
import { server } from "@base/primitives/icon/icons/server";
import { sparkles } from "@base/primitives/icon/icons/sparkles";
import { cpu } from "@base/primitives/icon/icons/cpu";
import { database } from "@base/primitives/icon/icons/database";
import { functionSquare } from "@base/primitives/icon/icons/function-square";
import { radio } from "@base/primitives/icon/icons/radio";
import { shield } from "@base/primitives/icon/icons/shield";
import { coins } from "@base/primitives/icon/icons/coins";
import { image as imageIcon } from "@base/primitives/icon/icons/image";
import { fuel } from "@base/primitives/icon/icons/fuel";
import { factory } from "@base/primitives/icon/icons/factory";
import { link } from "@base/primitives/icon/icons/link";
import { arrowLeftRight } from "@base/primitives/icon/icons/arrow-left-right";
import { vote } from "@base/primitives/icon/icons/vote";
import { treePine } from "@base/primitives/icon/icons/tree-pine";
import { signature } from "@base/primitives/icon/icons/signature";
import { memoryStick } from "@base/primitives/icon/icons/memory-stick";
import { arrowRight } from "@base/primitives/icon/icons/arrow-right";
import { alignJustify } from "@base/primitives/icon/icons/align-justify";
import { boxes } from "@base/primitives/icon/icons/boxes";
import { packagePlus } from "@base/primitives/icon/icons/package-plus";
import { link2 } from "@base/primitives/icon/icons/link-2";
import { code2 } from "@base/primitives/icon/icons/code-2";
import { cog } from "@base/primitives/icon/icons/cog";
import { network } from "@base/primitives/icon/icons/network";
import { binary } from "@base/primitives/icon/icons/binary";
import { smartphone } from "@base/primitives/icon/icons/smartphone";
import { bird } from "@base/primitives/icon/icons/bird";
import { appWindow } from "@base/primitives/icon/icons/app-window";
import { watch } from "@base/primitives/icon/icons/watch";
import { leaf } from "@base/primitives/icon/icons/leaf";
import { combine } from "@base/primitives/icon/icons/combine";
import { sigma } from "@base/primitives/icon/icons/sigma";
import { gauge } from "@base/primitives/icon/icons/gauge";
import { hash } from "@base/primitives/icon/icons/hash";
import { arrowDownUp } from "@base/primitives/icon/icons/arrow-down-up";
import { search } from "@base/primitives/icon/icons/search";
import { grid3x3 } from "@base/primitives/icon/icons/grid-3x3";
import { target } from "@base/primitives/icon/icons/target";
import { triangle } from "@base/primitives/icon/icons/triangle";
import { circle } from "@base/primitives/icon/icons/circle";

/// Lucide-id → svg-paths-string map. The `Icon` component takes a
/// raw string of inner SVG paths; we look up by the same id strings
/// `iconForSkill` returns. Keep this in lockstep with that
/// function — adding a new icon means an entry here AND a mapping
/// rule there.
export const ICON_REGISTRY: Record<string, string> = {
  box, calculator, quote, "toggle-left": toggleLeft, equal, "git-branch": gitBranch,
  repeat, parentheses, "corner-down-left": cornerDownLeft, list, package: packageIcon,
  layers, infinity: infinityIcon, "alert-triangle": alertTriangle, terminal,
  "file-text": fileText, "check-circle": checkCircle, code: codeIcon, palette,
  "mouse-pointer-2": mousePointer2, zap, download, hourglass, atom, route,
  type: typeIcon, server, sparkles, cpu, database, "function-square": functionSquare,
  radio, shield, coins, image: imageIcon, fuel, factory, link,
  "arrow-left-right": arrowLeftRight, vote, "tree-pine": treePine, signature,
  "memory-stick": memoryStick, "arrow-right": arrowRight, "align-justify": alignJustify,
  boxes, "package-plus": packagePlus, "link-2": link2, "code-2": code2, cog, network,
  binary, smartphone, bird, "app-window": appWindow, watch, leaf, combine, sigma,
  gauge, hash, "arrow-down-up": arrowDownUp, search, "grid-3x3": grid3x3, target,
  triangle, circle,
};
