// SPDX-License-Identifier: MIT
/**
 * ESLint configuration: typescript-eslint's strictest type-checked rules, enforced
 * TSDoc on every declaration, and no inline suppressions.
 *
 * @packageDocumentation
 */

import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import jsdoc from 'eslint-plugin-jsdoc';
import tsdoc from 'eslint-plugin-tsdoc';
import {defineConfig} from 'eslint/config';
import tseslint from 'typescript-eslint';

/** Declarations that must carry a documentation comment. */
const DOCUMENTED = [
    'ClassDeclaration',
    'FunctionDeclaration',
    'MethodDefinition',
    'PropertyDefinition',
    'TSInterfaceDeclaration',
    'TSTypeAliasDeclaration',
    'TSPropertySignature',
    'TSMethodSignature',
    'TSEnumDeclaration',
    'ExportNamedDeclaration > VariableDeclaration',
    'Program > VariableDeclaration',
];

export default defineConfig(
    {ignores: ['build/', 'dist/', 'node_modules/']},
    {
        linterOptions: {
            noInlineConfig: true,
            reportUnusedDisableDirectives: 'error',
            reportUnusedInlineConfigs: 'error',
        },
    },
    js.configs.recommended,
    tseslint.configs.strictTypeChecked,
    tseslint.configs.stylisticTypeChecked,
    jsdoc.configs['flat/recommended-typescript-error'],
    {
        languageOptions: {
            parserOptions: {
                project: ['tsconfig.json', 'tsconfig.node.json'],
                tsconfigRootDir: import.meta.dirname,
            },
        },
        plugins: {tsdoc},
        settings: {jsdoc: {mode: 'typescript'}},
        rules: {
            // Correctness and explicitness beyond the presets.
            eqeqeq: ['error', 'always'],
            curly: ['error', 'all'],
            'no-param-reassign': ['error', {props: true}],
            'no-shadow': 'off',
            '@typescript-eslint/no-shadow': 'error',
            'prefer-const': 'error',
            'object-shorthand': ['error', 'always'],
            '@typescript-eslint/consistent-type-imports': [
                'error',
                {fixStyle: 'inline-type-imports'},
            ],
            '@typescript-eslint/consistent-type-exports': 'error',
            '@typescript-eslint/explicit-function-return-type': 'error',
            '@typescript-eslint/explicit-module-boundary-types': 'error',
            '@typescript-eslint/prefer-readonly': 'error',
            '@typescript-eslint/strict-boolean-expressions': 'error',
            '@typescript-eslint/switch-exhaustiveness-check': 'error',
            '@typescript-eslint/require-array-sort-compare': 'error',
            '@typescript-eslint/no-import-type-side-effects': 'error',
            '@typescript-eslint/promise-function-async': 'error',
            '@typescript-eslint/return-await': ['error', 'always'],
            '@typescript-eslint/no-unnecessary-qualifier': 'error',
            '@typescript-eslint/no-useless-empty-export': 'error',
            '@typescript-eslint/method-signature-style': 'off',

            // Documentation: every declaration, TSDoc syntax, no filler.
            'tsdoc/syntax': 'error',
            'jsdoc/require-jsdoc': [
                'error',
                {publicOnly: false, require: {}, contexts: DOCUMENTED},
            ],
            'jsdoc/require-description': ['error', {contexts: ['any']}],
            'jsdoc/require-hyphen-before-param-description': ['error', 'always'],
            'jsdoc/require-throws': 'error',
            // TSDoc writes thrown types as {@link Type}, which this JSDoc rule cannot read.
            'jsdoc/require-throws-type': 'off',
            'jsdoc/informative-docs': 'error',
            'jsdoc/no-blank-blocks': 'error',
            'jsdoc/check-tag-names': [
                'error',
                {definedTags: ['packageDocumentation', 'remarks', 'privateRemarks']},
            ],
            'jsdoc/tag-lines': ['error', 'any', {startLines: 1}],
        },
    },
    {
        files: ['src/**/*.ts', 'tests/shell/**/*.ts'],
        rules: {
            // Synchronous file reads block the compositor.
            'no-restricted-syntax': [
                'error',
                {
                    selector:
                        'CallExpression[callee.property.name=/^(file_get_contents|load_contents|read_bytes|query_info|enumerate_children)$/]',
                    message: 'Use the *_async variant: synchronous I/O blocks GNOME Shell.',
                },
                {
                    selector:
                        "MemberExpression[object.property.name='panel'][property.name='style']",
                    message:
                        'GNOME Shell overview owns Main.panel.style and clears it; size the actor instead.',
                },
            ],
            'no-console': 'error',
        },
    },
    prettier,
);
