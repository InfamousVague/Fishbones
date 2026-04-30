// Fengari (Lua VM in pure JS) doesn't ship TypeScript types — only
// the published .js source. Without an ambient declaration, every
// import from "fengari" trips TS7016. We declare the surface API
// the runtime actually uses; a future tightening can replace this
// with the upstream-shipped types if Fengari ever publishes them.
//
// Surface kept narrow on purpose — rest of Fengari's API is untyped
// `unknown` to avoid the runtime accidentally reaching for a method
// without thinking about it.

declare module "fengari" {
  /// Opaque pointer to a Lua state (`lua_State *`). Treated as
  /// unknown so TypeScript can't peek inside; the only legal
  /// operations are passing it back to lua / lualib / lauxlib.
  export type LuaState = unknown;

  export const lua: {
    LUA_OK: number;
    lua_gettop(L: LuaState): number;
    lua_pop(L: LuaState, n: number): void;
    lua_pushjsfunction(L: LuaState, fn: (state: LuaState) => number): void;
    lua_setglobal(L: LuaState, name: Uint8Array): void;
    lua_pcall(
      L: LuaState,
      nargs: number,
      nresults: number,
      msgh: number,
    ): number;
    lua_tostring(L: LuaState, idx: number): Uint8Array | null;
    lua_toboolean(L: LuaState, idx: number): boolean;
  };

  export const lualib: {
    luaL_openlibs(L: LuaState): void;
  };

  export const lauxlib: {
    luaL_newstate(): LuaState;
    luaL_loadbuffer(
      L: LuaState,
      buff: Uint8Array,
      sz: null,
      name: Uint8Array,
    ): number;
    luaL_tolstring(L: LuaState, idx: number, len: null): Uint8Array | null;
    luaL_checklstring(L: LuaState, idx: number, len: null): Uint8Array;
    luaL_optlstring(
      L: LuaState,
      idx: number,
      def: string,
      len: null,
    ): Uint8Array;
  };

  export function to_luastring(s: string): Uint8Array;
  export function to_jsstring(b: Uint8Array): string;
}
