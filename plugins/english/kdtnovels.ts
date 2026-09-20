import { load } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { NovelStatus } from '@libs/novelStatus';

class KDTNovels implements Plugin.PluginBase {
  id = 'kdtnovels';
  name = 'KDT Novels';
  site = 'https://kdtnovels.net';
  icon = 'multisrc/lightnovelwp/kdtnovels/icon.png';
  version = '2.0.0';

  private async allNovels(): Promise<Plugin.NovelItem[]> {
    const body = await fetchApi(`${this.site}/series/`).then(res => res.text());
    const $ = load(body);

    return $('a[href^="/series/"]')
      .filter((_, el) => $(el).attr('href') !== '/series/')
      .map((_, el) => {
        const item = $(el);
        const image = item.find('img').attr('src');
        return {
          name: item.find('span.font-semibold').first().text().trim(),
          path: item.attr('href')!,
          cover: image ? new URL(image, this.site).href : undefined,
        };
      })
      .toArray();
  }

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    return pageNo === 1 ? this.allNovels() : [];
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    if (pageNo !== 1) return [];
    const query = searchTerm.toLowerCase();
    return (await this.allNovels()).filter(novel =>
      novel.name.toLowerCase().includes(query),
    );
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const body = await fetchApi(new URL(novelPath, this.site).href).then(res =>
      res.text(),
    );
    const $ = load(body);
    const chapters: Plugin.ChapterItem[] = [];
    const pattern =
      /\\"slug\\":\\"([^"\\]+)\\",\\"volume\\":\\"([^"\\]*)\\",\\"volume_type\\":\\"[^"\\]*\\",\\"chapter_no\\":\\"([^"\\]*)\\",\\"subtitle\\":(?:\\"([^"\\]*)\\"|null),\\"locked\\":(true|false)/g;

    for (const match of body.matchAll(pattern)) {
      if (match[5] === 'true') continue;
      const chapterNumber = Number(match[3]);
      const volume = match[2] ? `Vol. ${match[2]} ` : '';
      const subtitle = match[4] ? `: ${match[4]}` : '';
      chapters.push({
        name: `${volume}Ch. ${match[3]}${subtitle}`,
        path: `/${match[1]}/`,
        chapterNumber: Number.isFinite(chapterNumber)
          ? chapterNumber
          : undefined,
      });
    }

    const image = $('img[alt]').first().attr('src');
    const statusText = $('body')
      .text()
      .match(/\b(ongoing|completed|dropped|hiatus)\b/i)?.[1];
    const statuses: Record<string, string> = {
      ongoing: NovelStatus.Ongoing,
      completed: NovelStatus.Completed,
      dropped: NovelStatus.Cancelled,
      hiatus: NovelStatus.OnHiatus,
    };

    return {
      name: $('h1').first().text().trim(),
      path: novelPath,
      cover: image ? new URL(image, this.site).href : undefined,
      summary: $('meta[name="description"]').attr('content'),
      status: statuses[statusText?.toLowerCase() || ''] || NovelStatus.Unknown,
      chapters,
    };
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const body = await fetchApi(new URL(chapterPath, this.site).href).then(
      res => res.text(),
    );
    return load(body)('article.reader-content').html() || '';
  }
}

export default new KDTNovels();

