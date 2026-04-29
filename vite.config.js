import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readFileSync, writeFileSync } from 'fs';

function copyCSS() {
    return {
        name: 'copy-css',
        closeBundle() {
            const css = readFileSync(resolve(__dirname, 'src/style.css'), 'utf-8');
            writeFileSync(resolve(__dirname, 'dist/style.css'), css);
        },
    };
}

export default defineConfig({
    build: {
        lib: {
            entry: resolve(__dirname, 'src/danish.js'),
            name: 'CentiaDanish',
            formats: ['es', 'cjs'],
            fileName: (format) => `danish.${format === 'es' ? 'mjs' : 'cjs'}`,
        },
        copyPublicDir: false,
    },
    plugins: [copyCSS()],
});
