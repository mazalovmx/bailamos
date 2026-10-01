import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config(
  {ignores: ['**/node_modules/**', '**/.next/**', '**/next-env.d.ts', '**/dist/**', 'test-results/**', '.playwright-mcp/**']},
  js.configs.recommended, ...ts.configs.recommended,
  {files: ['**/*.{js,mjs,ts,tsx}'], languageOptions: {globals: {process: 'readonly', console: 'readonly'}}}
);
