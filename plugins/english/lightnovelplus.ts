import { load } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';
import { Plugin } from '@/types/plugin';

type ApiChapter = {
  id: number;
  title: string;
  bookId: number;
  displayOrder: number;
};

class LightNovelPlus implements Plugin.PluginBase {
  id = 'lightnovelplus';
  name = 'LightNovelPlus';
  version = '3.0.0';
  icon = 'multisrc/readnovelfull/lightnovelplus/icon.png';
  site = 'https://lightnovelplus.com/';

  private parseNovels(html: string): Plugin.NovelItem[] {
    const $ = load(html);
    const novels: Plugin.NovelItem[] = [];
    const seen = new Set<string>();

    $('h3.truyen-title > a[href*="/detail/"]').each((_, element) => {
      const anchor = $(element);
      const href = anchor.attr('href');
      if (!href) return;

      const path = new URL(href, this.site).pathname.replace(/^\//, '');
      if (seen.has(path)) return;
      seen.add(path);

      novels.push({
        name: anchor.attr('title')?.trim() || anchor.text().trim(),
        path,
        cover: defaultCover,
      });
    });

    return novels;
  }

  async popularNovels(
    pageNo: number,
    { showLatestNovels }: Plugin.PopularNovelsOptions,
  ): Promise<Plugin.NovelItem[]> {
    const type = showLatestNovels ? 'last_release' : 'hot_novel';
    const url = `${this.site}en/class?type=${type}&page=${pageNo}`;
    const html = await fetchApi(url).then(response => response.text());
    return this.parseNovels(html);
  }

  async searchNovels(searchTerm: string): Promise<Plugin.NovelItem[]> {
    const url = `${this.site}en/search?keyword=${encodeURIComponent(searchTerm)}`;
    const html = await fetchApi(url).then(response => response.text());
    return this.parseNovels(html);
  }

  private async fetchChapterPage(
    bookId: number,
    page: number,
  ): Promise<ApiChapter[]> {
    let lastStatus = 0;
    const url = `${this.site}api/book/detail?bookId=${bookId}&page_num=${page}&page_size=50&language=en`;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetchApi(url, {
        headers: {
          Accept: 'application/json',
          'X-Custom-Header': 'lightnovelplus.com',
        },
      });
      lastStatus = response.status;
      if (response.ok) {
        const result = (await response.json()) as {
          code: number;
          data?: { chapter_list?: ApiChapter[] };
        };
        if (result.code === 0 && result.data?.chapter_list) {
          return result.data.chapter_list;
        }
      }

      if (attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 1000));
      }
    }

    throw new Error(`Failed to load chapter page (${lastStatus}): ${url}`);
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const firstHtml = await fetchApi(
      new URL(novelPath, this.site).toString(),
    ).then(response => response.text());
    const $ = load(firstHtml);
    const cover = $('img.detail-cover');
    const name = cover.attr('alt')?.trim() || $('title').text().trim();

    const details = new Map<string, string>();
    $('.info > div, .info-holder .info > div').each((_, element) => {
      const label = $(element)
        .find('h3')
        .first()
        .text()
        .replace(':', '')
        .trim();
      const value = $(element)
        .find('a, h3')
        .slice(1)
        .map((__, item) => $(item).text().trim())
        .get()
        .join(', ');
      if (label) details.set(label.toLowerCase(), value);
    });

    const pageNumbers = $('a[href*="/page/"]')
      .map((_, element) =>
        Number(
          $(element)
            .attr('href')
            ?.match(/\/page\/(\d+)/)?.[1],
        ),
      )
      .get()
      .filter(Number.isFinite);
    const pageCount = Math.max(1, ...pageNumbers);

    const bookId = Number(novelPath.match(/detail\/(\d+)/)?.[1]);
    if (!Number.isFinite(bookId)) throw new Error('Invalid novel path');
    const chapterPages = await Promise.all(
      Array.from({ length: pageCount }, (_, index) =>
        this.fetchChapterPage(bookId, index + 1),
      ),
    );
    const parsedChapters: Plugin.ChapterItem[] = chapterPages
      .flat()
      .map(chapter => ({
        name: `${chapter.displayOrder}: ${chapter.title}`,
        path: `en/book/${chapter.bookId}/${chapter.id}`,
        chapterNumber: chapter.displayOrder,
      }));
    const chapters = parsedChapters.filter(
      (chapter, index) =>
        parsedChapters.findIndex(item => item.path === chapter.path) === index,
    );
    const expectedChapterCount = Number(details.get('chapters'));
    if (
      Number.isFinite(expectedChapterCount) &&
      expectedChapterCount > 0 &&
      chapters.length !== expectedChapterCount
    ) {
      throw new Error(
        `Incomplete chapter list: expected ${expectedChapterCount}, got ${chapters.length}`,
      );
    }

    const statusText = details.get('status')?.toLowerCase() || '';
    const status = statusText.includes('completed')
      ? NovelStatus.Completed
      : statusText.includes('ongoing')
        ? NovelStatus.Ongoing
        : statusText.includes('hiatus')
          ? NovelStatus.OnHiatus
          : NovelStatus.Unknown;

    return {
      path: novelPath,
      name,
      cover: cover.attr('src') || defaultCover,
      author: details.get('author') || '',
      genres: details.get('genre') || '',
      status,
      summary: $('.desc-text').text().trim(),
      chapters,
    };
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const html = await fetchApi(
      new URL(chapterPath, this.site).toString(),
    ).then(response => response.text());
    const $ = load(html);
    $('#chapter-content script, #chapter-content style').remove();
    return $('#chapter-content').html() || '';
  }
}

export default new LightNovelPlus();

