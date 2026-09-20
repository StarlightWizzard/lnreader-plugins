import { load } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { NovelStatus } from '@libs/novelStatus';

class HangulPlanet implements Plugin.PluginBase {
  id = 'hangulplanet';
  name = 'HangulPlanet';
  site = 'https://hangulplanet.com';
  icon = 'multisrc/madara/hangulplanet/icon.png';
  version = '2.0.0';

  private async browse(): Promise<Plugin.NovelItem[]> {
    const body = await fetchApi(`${this.site}/browse`).then(res => res.text());
    const $ = load(body);

    return $('a[href^="/novel/"]')
      .filter((_, el) => ($(el).attr('href') || '').split('/').length === 3)
      .map((_, el) => {
        const item = $(el);
        const path = item.attr('href')!;
        const image = item.find('img').attr('src');
        let cover = image;
        if (image?.startsWith('/_next/image')) {
          cover = new URL(image, this.site).searchParams.get('url') || image;
        }
        return {
          name: item.find('h3').text().trim(),
          path,
          cover,
        };
      })
      .toArray();
  }

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    return pageNo === 1 ? this.browse() : [];
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    if (pageNo !== 1) return [];
    const query = searchTerm.toLowerCase();
    return (await this.browse()).filter(novel =>
      novel.name.toLowerCase().includes(query),
    );
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const body = await fetchApi(new URL(novelPath, this.site).href).then(res =>
      res.text(),
    );
    const $ = load(body);
    const chapterMap = new Map<string, Plugin.ChapterItem>();

    $('a[href*="/chapter-"]').each((_, el) => {
      const path = $(el).attr('href');
      if (!path || chapterMap.has(path)) return;
      const match = path.match(/chapter-(\d+(?:\.\d+)?)/i);
      const chapterNumber = match ? Number(match[1]) : undefined;
      const label = $(el).text().replace(/\s+/g, ' ').trim();
      chapterMap.set(path, {
        name: label || `Chapter ${chapterNumber ?? ''}`.trim(),
        path,
        chapterNumber,
      });
    });

    const statusText = $('body')
      .text()
      .match(/\b(Ongoing|Completed|Dropped|Hiatus)\b/i)?.[1];
    const statuses: Record<string, string> = {
      ongoing: NovelStatus.Ongoing,
      completed: NovelStatus.Completed,
      dropped: NovelStatus.Cancelled,
      hiatus: NovelStatus.OnHiatus,
    };
    const image = $('img[alt]').first().attr('src');
    let cover = image;
    if (image?.startsWith('/_next/image')) {
      cover = new URL(image, this.site).searchParams.get('url') || image;
    }

    return {
      name: $('h1').first().text().trim(),
      path: novelPath,
      cover,
      summary: $('h2')
        .filter((_, el) => $(el).text().trim() === 'Synopsis')
        .parent()
        .find('p')
        .first()
        .text()
        .trim(),
      status: statuses[statusText?.toLowerCase() || ''] || NovelStatus.Unknown,
      chapters: Array.from(chapterMap.values()).sort(
        (a, b) => (a.chapterNumber || 0) - (b.chapterNumber || 0),
      ),
    };
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const body = await fetchApi(new URL(chapterPath, this.site).href).then(
      res => res.text(),
    );
    return load(body)('div.reader-prose').html() || '';
  }
}

export default new HangulPlanet();

