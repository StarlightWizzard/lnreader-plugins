import { CheerioAPI, load as loadCheerio } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { NovelStatus } from '@libs/novelStatus';
import { Filters } from '@libs/filterInputs';

type FictioneerOptions = {
  browsePage: string;
  lang?: string;
  layout?: 'penguinSquad';
  versionIncrements?: number;
};

export type FictioneerMetadata = {
  id: string;
  sourceSite: string;
  sourceName: string;
  options: FictioneerOptions;
};

export class FictioneerPlugin implements Plugin.PluginBase {
  id: string;
  name: string;
  icon: string;
  site: string;
  version: string;
  options: FictioneerOptions;
  filters: Filters | undefined = undefined;

  constructor(metadata: FictioneerMetadata) {
    this.id = metadata.id;
    this.name = metadata.sourceName;
    this.icon = `multisrc/fictioneer/${metadata.id.toLowerCase()}/icon.png`;
    this.site = metadata.sourceSite;
    const versionIncrements = metadata.options?.versionIncrements || 0;
    this.version = `1.1.${0 + versionIncrements}`;
    this.options = metadata.options;
  }

  private parseNovels(
    loadedCheerio: CheerioAPI,
    selector: string,
  ): Plugin.NovelItem[] {
    return loadedCheerio(selector)
      .map((i, el) => {
        const element = loadedCheerio(el);
        const novelName = element.find('h3 > a').text();
        const novelCover = element.find('a.cell-img:has(img)').attr('href');
        const novelUrl = element.find('h3 > a').attr('href');

        if (!novelUrl) return;

        return {
          name: novelName,
          cover: novelCover,
          path: new URL(novelUrl, this.site).pathname.substring(1),
        };
      })
      .toArray();
  }

  async popularNovels(
    pageNo: number,
    // {
    //   showLatestNovels,
    //   filters,
    // }: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    if (this.options.layout === 'penguinSquad') {
      if (pageNo !== 1) return [];
      const req = await fetchApi(`${this.site}/${this.options.browsePage}`);
      const loadedCheerio = loadCheerio(await req.text());

      return loadedCheerio('a[href^="/novels/"]')
        .filter((_, el) => {
          const href = loadedCheerio(el).attr('href') || '';
          return href.split('/').length === 3;
        })
        .map((_, el) => {
          const element = loadedCheerio(el);
          const novelUrl = element.attr('href')!;
          return {
            name: element.find('h3').text().trim(),
            cover: element.find('img').attr('src'),
            path: novelUrl.substring(1),
          };
        })
        .toArray();
    }

    const req = await fetchApi(
      this.site +
        '/' +
        this.options.browsePage +
        '/' +
        (pageNo === 1 ? '' : 'page/' + pageNo + '/'),
    );
    const body = await req.text();
    const loadedCheerio = loadCheerio(body);

    return this.parseNovels(
      loadedCheerio,
      '#featured-list > li > div > div, #list-of-stories > li > div > div',
    );
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const req = await fetchApi(this.site + '/' + novelPath + '/');
    const body = await req.text();
    const loadedCheerio = loadCheerio(body);

    if (this.options.layout === 'penguinSquad') {
      const statusText = loadedCheerio('span[data-slot="badge"]')
        .filter((_, el) =>
          /^(Ongoing|Completed|Dropped|Hiatus)$/i.test(
            loadedCheerio(el).text().trim(),
          ),
        )
        .first()
        .text()
        .trim();
      const statusMap: Record<string, string> = {
        ongoing: NovelStatus.Ongoing,
        completed: NovelStatus.Completed,
        dropped: NovelStatus.Cancelled,
        hiatus: NovelStatus.OnHiatus,
      };
      const meta = loadedCheerio('h1')
        .nextAll('div.text-muted-foreground')
        .first();

      return {
        path: novelPath,
        name: loadedCheerio('h1').first().text().trim(),
        author: meta.find('span').last().text().trim(),
        cover: loadedCheerio('img[alt]').first().attr('src'),
        genres: loadedCheerio('h1')
          .prevAll('div')
          .first()
          .find('span[data-slot="badge"]')
          .map((_, el) => loadedCheerio(el).text().trim())
          .toArray()
          .join(','),
        summary: loadedCheerio('p.line-clamp-10').text().trim(),
        status: statusMap[statusText.toLowerCase()] || NovelStatus.Unknown,
        chapters: loadedCheerio('a[href*="/chapter-"]')
          .filter(
            (_, el) => loadedCheerio(el).find('svg.lucide-lock').length === 0,
          )
          .map((_, el) => {
            const element = loadedCheerio(el);
            const href = element.attr('href');
            if (!href) return;
            const number = element.find('span.font-mono').text().trim();
            const title = element.find('p').first().text().trim();
            return {
              name: title ? `Chapter ${number}: ${title}` : `Chapter ${number}`,
              path: href.substring(1),
              chapterNumber: Number(number),
            };
          })
          .toArray(),
      };
    }

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: loadedCheerio('h1.story__identity-title').text(),
    };

    // novel.artist = '';
    novel.author = loadedCheerio('div.story__identity-meta')
      .text()
      .split('|')[0]
      .replace('Author: ', '')
      .replace('by ', '')
      .trim();
    novel.cover = loadedCheerio('figure.story__thumbnail > a').attr('href');
    novel.genres = loadedCheerio('div.tag-group > a, section.tag-group > a')
      .map((i, el) => loadedCheerio(el).text())
      .toArray()
      .join(',');

    loadedCheerio('section.story__summary .related-stories-block').remove();
    novel.summary = loadedCheerio('section.story__summary').text();

    novel.chapters = loadedCheerio('li.chapter-group__list-item._publish')
      .filter((i, el) => !el.attribs['class'].includes('_password'))
      .filter(
        (i, el) =>
          !loadedCheerio(el)
            .find('i')
            .first()!
            .attr('class')!
            .includes('fa-lock'),
      )
      .map((i, el) => {
        const chapterName = loadedCheerio(el).find('a').text();
        const chapterUrl = loadedCheerio(el).find('a').attr('href');

        if (!chapterUrl) return;
        return {
          name: chapterName,
          path: new URL(chapterUrl, this.site).pathname.substring(1),
        };
      })
      .toArray();

    const status = loadedCheerio('span.story__status').text().trim();
    if (status === 'Ongoing') novel.status = NovelStatus.Ongoing;
    if (status === 'Completed') novel.status = NovelStatus.Completed;
    if (status === 'Cancelled') novel.status = NovelStatus.Cancelled;
    if (status === 'Hiatus') novel.status = NovelStatus.OnHiatus;

    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const req = await fetchApi(this.site + '/' + chapterPath + '/');
    const body = await req.text();

    const loadedCheerio = loadCheerio(body);

    if (this.options.layout === 'penguinSquad') {
      return loadedCheerio('div.reader-content').html() || '';
    }

    // chapterTransformJs HERE

    return loadedCheerio('section#chapter-content > div').html() || '';
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    if (this.options.layout === 'penguinSquad') {
      if (pageNo !== 1) return [];
      const novels = await this.popularNovels(1);
      const query = searchTerm.toLowerCase();
      return novels.filter(novel => novel.name.toLowerCase().includes(query));
    }

    const req = await fetchApi(
      this.site +
        `/${pageNo === 1 ? '' : 'page/' + pageNo + '/'}?s=${encodeURIComponent(searchTerm)}&post_type=fcn_story`,
    );
    const body = await req.text();
    const loadedCheerio = loadCheerio(body);

    return this.parseNovels(
      loadedCheerio,
      '#search-result-list > li > div > div',
    );
  }

  // resolveUrl = (path: string, isNovel?: boolean) =>
  //   this.site + '/' + path + '/';
}

