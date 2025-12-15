import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
    root: path.resolve(__dirname, './'),
    build: {
        outDir: path.resolve(__dirname, '../dist/public'),
        emptyOutDir: true,
        lib: {
            entry: path.resolve(__dirname, 'main.ts'),
            name: 'ECVoiceWidget',
            fileName: () => `widget.js`, // Force simple filename
            formats: ['iife'], // IIFE is best for direct script tag inclusion without modules
        },
        rollupOptions: {
            output: {
                // Ensure consistency in variable names if needed
                extend: true,
            }
        }
    },
    define: {
        'process.env': {} // prevent crash if some lib tries to access process.env
    }
});
