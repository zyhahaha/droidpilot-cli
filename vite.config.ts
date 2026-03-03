import { defineConfig } from 'vite';
import nodeResolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import { builtinModules } from 'module';

// 需要排除的依赖（运行时从 node_modules 加载）
const externalDeps = [
  'langchain',
  '@langchain/core',
  '@langchain/openai',
  'zod',
];

export default defineConfig({
  build: {
    outDir: 'dist',
    sourcemap: true,
    minify: false,
    lib: {
      entry: 'src/index.ts',
      formats: ['cjs'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      external: [
        ...builtinModules,
        ...builtinModules.map(m => `node:${m}`),
        ...externalDeps,
        /^@langchain\/.*/,
      ],
      output: {
        entryFileNames: '[name].js',
      },
    },
  },
  plugins: [
    nodeResolve({ preferBuiltins: true }),
    commonjs(),
    json(),
  ],
});
