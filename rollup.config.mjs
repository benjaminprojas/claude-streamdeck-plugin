import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import typescript from "@rollup/plugin-typescript";

export default {
  input: "src/plugin.ts",
  output: {
    file: "com.claude.status.sdPlugin/bin/plugin.js",
    format: "es",
    sourcemap: true,
  },
  external: [
    // Node.js builtins
    "fs",
    "path",
    "os",
    "crypto",
    "buffer",
    "events",
    "stream",
    "util",
    "http",
    "https",
    "url",
    "net",
    "tls",
    "zlib",
    // External dependencies provided by Stream Deck runtime
    "ws",
  ],
  plugins: [
    resolve({
      preferBuiltins: true,
    }),
    commonjs(),
    typescript({
      tsconfig: "./tsconfig.json",
    }),
  ],
};
