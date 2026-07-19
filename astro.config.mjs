// @ts-check

import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
	// Domínio de produção — usado para gerar URLs canônicas e Open Graph absolutas.
	site: 'https://copacristafortaleza.com.br',
	vite: {
		plugins: [tailwindcss()],
	},
});
