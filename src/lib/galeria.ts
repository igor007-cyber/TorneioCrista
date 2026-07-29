// Fonte das fotos da página /galeria.
//
// As imagens ficam hospedadas nas galerias do site da PIB Fortaleza (plugin
// "Photo Gallery"). Em vez de listar centenas de URLs na mão, buscamos a lista
// direto do endpoint do plugin NO MOMENTO DO BUILD e caímos num snapshot local
// (src/data/galeria-snapshot.json) caso o site esteja fora do ar. Assim a
// galeria se atualiza sozinha a cada deploy, mas o build nunca quebra.

import snapshot from '../data/galeria-snapshot.json';

export interface Album {
	/** Identificador usado na URL/âncora (#slug). */
	slug: string;
	title: string;
	/** Legenda curta com as datas do fim de semana. */
	date: string;
	/** Álbum original na PIB, para o link "ver álbum completo". */
	source: string;
	/** URLs das imagens em tamanho cheio (sem o parâmetro ?bwg de cache). */
	images: string[];
}

type AlbumConfig = Omit<Album, 'images'> & {
	/** IDs do shortcode/galeria no plugin da PIB (lidos do HTML da página). */
	shortcodeId: number;
	galleryId: number;
	/** Chave correspondente dentro do snapshot local. */
	snapshotKey: keyof typeof snapshot;
};

const ALBUMS: AlbumConfig[] = [
	{
		slug: 'primeira-fase',
		title: 'Primeira Fase',
		date: '17 e 18 de julho',
		source: 'https://pibfortaleza.org.br/fotos-primeira-fase-copa-crista-2026-colegio-7-de-setembro/',
		shortcodeId: 530,
		galleryId: 272,
		snapshotKey: 'primeira-fase',
	},
	{
		slug: 'segundo-fim-de-semana',
		title: 'Segundo Fim de Semana',
		date: '24 e 25 de julho',
		source: 'https://pibfortaleza.org.br/fotos-segundo-fim-de-semana-copa-crista-2026/',
		shortcodeId: 532,
		galleryId: 273,
		snapshotKey: 'segundo-fim-de-semana',
	},
];

const AJAX_URL = 'https://pibfortaleza.org.br/wp-admin/admin-ajax.php?action=bwg_frontend_data';
const MAX_PAGES = 60; // trava de segurança (o plugin devolve 30 por página)

/** Converte a URL cheia na versão em miniatura servida pelo plugin. */
export function thumbUrl(full: string): string {
	return full.replace('/photo-gallery/', '/photo-gallery/thumb/');
}

/** Extrai as URLs das imagens (em tamanho cheio, sem o ?bwg) de uma resposta HTML. */
function parseImageUrls(html: string): string[] {
	const re = /bwg_lightbox"[^>]*href="([^"]*?photo-gallery\/[^"?]+\.(?:png|jpe?g))(?:\?[^"]*)?"/gi;
	const urls: string[] = [];
	for (const m of html.matchAll(re)) urls.push(m[1]);
	return urls;
}

/** Percorre as páginas do álbum no endpoint do plugin e devolve todas as imagens. */
async function fetchAlbumImages(cfg: AlbumConfig): Promise<string[]> {
	const seen = new Set<string>();
	for (let page = 1; page <= MAX_PAGES; page++) {
		const body = new URLSearchParams({
			shortcode_id: String(cfg.shortcodeId),
			gallery_id: String(cfg.galleryId),
			tag: '0',
			album_id: '0',
			theme_id: '1',
			page_number_0: String(page),
			bwg_random_seed: '1', // seed fixa => ordem estável entre builds
		});
		const res = await fetch(AJAX_URL, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body,
		});
		if (!res.ok) throw new Error(`galeria ${cfg.slug}: HTTP ${res.status}`);
		const found = parseImageUrls(await res.text());
		for (const url of found) seen.add(url);
		// A última página vem incompleta (< 30 itens): fim do álbum.
		if (found.length < 30) break;
	}
	return [...seen];
}

let cache: Promise<Album[]> | null = null;

/** Álbuns com suas imagens. Resultado memoizado para as páginas compartilharem
 *  uma única busca durante o build. */
export function getAlbums(): Promise<Album[]> {
	cache ??= Promise.all(
		ALBUMS.map(async ({ shortcodeId, galleryId, snapshotKey, ...meta }) => {
			let images: string[] = [];
			try {
				images = await fetchAlbumImages({ shortcodeId, galleryId, snapshotKey, ...meta });
			} catch (err) {
				console.warn(`[galeria] busca ao vivo falhou (${meta.slug}), usando snapshot:`, err);
			}
			if (images.length === 0) images = snapshot[snapshotKey] ?? [];
			return { ...meta, images };
		}),
	);
	return cache;
}
