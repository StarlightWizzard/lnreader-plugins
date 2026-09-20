import { CheerioAPI, load as parseHTML } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { storage } from '@libs/storage';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';

type ChapterJSON = {
  items: ChapterItem[];
  total: number;
  pages?: number;
  page?: number;
  per_page?: number;
  order?: string;
};

type ChapterItem = {
  id: number;
  number?: string;
  title: string;
  url: string;
  locked?: boolean;
};

class CrimsonScrollsPlugin implements Plugin.PluginBase {
  id = 'crimsonscrolls';
  name = 'Crimson Scrolls';
  icon = 'src/en/crimsonscrolls/icon.png';
  site = 'https://crimsonscrolls.net';
  version = '1.1.0';

  hideLocked = storage.get('hideLocked');
  pluginSettings = {
    hideLocked: {
      value: '',
      label: 'Hide locked chapters',
      type: 'Switch',
    },
  };

  async fetchNovelItems(page: number, searchTerm?: string) {
    const params = new URLSearchParams({
      per_page: '24',
      page: page.toString(),
      _embed: '1',
      orderby: 'modified',
      order: 'desc',
    });
    if (searchTerm) params.set('search', searchTerm);

    const response = await fetchApi(
      `${this.site}/wp-json/wp/v2/novel?${params.toString()}`,
    );
    if (!response.ok) {
      if (response.status === 400 && page > 1) return [];
      throw new Error(`Could not fetch novels (HTTP ${response.status})`);
    }

    const items = await response.json();
    return items.map((item: any) => ({
      name: parseHTML(item.title?.rendered || '')
        .text()
        .trim(),
      path: new URL(item.link, this.site).pathname.substring(1),
      cover:
        item._embedded?.['wp:featuredmedia']?.[0]?.source_url || defaultCover,
    }));
  }

  async fetchChapters(
    id: number,
    page?: number | undefined,
  ): Promise<ChapterItem[]> {
    const url = `${this.site}/wp-json/crimsonscrolls/v2/novel-chapters?novel_id=${id}&tier=free&per_page=75&order=ASC`;
    const data: ChapterJSON = await fetchApi(`${url}&page=${page ?? 1}`).then(
      r => r.json(),
    );

    const items = data.items || [];
    const locked = items.some(e => e.locked);

    if (
      data.pages &&
      (data.page ?? 1) < data.pages &&
      !(locked && this.hideLocked)
    ) {
      const nextItems = await this.fetchChapters(id, (data.page ?? 0) + 1);
      return items.concat(nextItems);
    }

    return items;
  }

  parseNovels(loadedCheerio: CheerioAPI) {
    const novels: Plugin.NovelItem[] = [];

    loadedCheerio(':is(a.live-search-item, div.novel-list-card)').each(
      (i, el) => {
        const novelName = loadedCheerio(el)
          .find(':is(div.live-search-title, h3.novel-title)')
          .text()
          .trim();
        const novelCover = loadedCheerio(el)
          .find(':is(img.live-search-cover, div.novel-cover img)')
          .attr('src');
        const novelUrl =
          loadedCheerio(el).find('a').attr('href') ||
          loadedCheerio(el).attr('href');

        if (!novelUrl) return;

        const novel = {
          name: novelName
            .trim()
            .split(' ')
            .filter(e => e.length > 0)
            .join(' '),
          cover: novelCover,
          path: novelUrl
            ? new URL(novelUrl, this.site).pathname.substring(1)
            : defaultCover,
        };
        novels.push(novel);
      },
    );
    return novels;
  }

  async popularNovels(page: number): Promise<Plugin.NovelItem[]> {
    return this.fetchNovelItems(page);
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const result = await fetchApi(`${this.site}/${novelPath}`).then(r =>
      r.text(),
    );

    const loadedCheerio = parseHTML(result);
    const novelInfo = loadedCheerio('main');

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: novelInfo.find('h1').first().text().trim() || 'Untitled',
      cover: novelInfo.find('.cs-cover img').attr('src') || defaultCover,
      summary: novelInfo.find('.cs-synopsis-content').text().trim(),
      author: novelInfo.find('.cs-novel-creator-card--author').text().trim(),
      chapters: [],
    };

    novel.genres = novelInfo
      .find('.cs-detail-genres a')
      .map((_, el) => loadedCheerio(el).text().trim())
      .toArray()
      .join(',');

    const rawStatus = novelInfo.find('.cs-cover-status').text().trim();
    const map: Record<string, string> = {
      ongoing: NovelStatus.Ongoing,
      hiatus: NovelStatus.OnHiatus,
      dropped: NovelStatus.Cancelled,
      cancelled: NovelStatus.Cancelled,
      completed: NovelStatus.Completed,
    };
    novel.status = map[rawStatus.toLowerCase()] ?? NovelStatus.Unknown;

    const id = loadedCheerio('[data-novel-chapters]').data('novel-chapters');
    const chapters = await this.fetchChapters(Number(id));

    const novelChapters: Plugin.ChapterItem[] = [];
    chapters.forEach((chapter, index) => {
      if (!(chapter.locked && this.hideLocked)) {
        novelChapters.push({
          name: chapter.locked ? `🔒 ${chapter.title}` : chapter.title,
          path: chapter.url
            ? new URL(chapter.url, this.site).pathname.substring(1)
            : '',
          chapterNumber: Number(chapter.number) || index + 1,
        });
      }
    });
    novel.chapters = novelChapters;

    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const body = await fetchApi(`${this.site}/${chapterPath}`).then(r =>
      r.text(),
    );
    const loadedCheerio = parseHTML(body);
    const content = loadedCheerio('article.cs-reader > p').clone();
    content.each((_, element) => {
      const paragraph = loadedCheerio(element);
      paragraph.html(
        (paragraph.html() || '').replace(
          /\s*Read on CrimsonScrolls\.net\s*#[a-f0-9]+/gi,
          '',
        ),
      );
    });
    return parseHTML('<div></div>')('div').append(content).html() || '';
  }

  async searchNovels(searchTerm: string): Promise<Plugin.NovelItem[]> {
    return this.fetchNovelItems(1, searchTerm);
  }

  // not sure purpose of this, commented out
  // resolveUrl = (path: string, isNovel?: boolean) =>
  //   this.site + '/novel/' + path;
}

export default new CrimsonScrollsPlugin();

