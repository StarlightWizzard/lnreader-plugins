import { defaultCover } from '@libs/defaultCover';
import { fetchApi } from '@libs/fetch';
import { Filters, FilterTypes, FilterValueWithType } from '@libs/filterInputs';
import { Plugin } from '@/types/plugin';
import { load as parseHTML } from 'cheerio';

// TODO: change layoput, layout has updated

class DDLPlugin implements Plugin.PluginBase {
  id = 'DDL.com';
  name = 'Divine Dao Library';
  site = 'https://www.divinedaolibrary.com/';
  version = '1.2.0';
  icon = 'src/en/divinedaolibrary/icon.png';

  filters = {
    category: {
      type: FilterTypes.CheckboxGroup,
      label: 'State',
      value: ['Completed', 'Translating', 'Lost in Voting Poll', 'Dropped'],
      options: [
        { label: 'Completed', value: 'Completed' },
        { label: 'Translating', value: 'Translating' },
        { label: 'Lost in Voting Poll', value: 'Lost in Voting Poll' },
        { label: 'Dropped', value: 'Dropped' },
        { label: 'Personally Written', value: 'Personally Written' },
      ],
    },
  } satisfies Filters;

  allNovelsCache: readonly (readonly [string, string, string])[] | undefined;
  novelItemCache = new Map<string, Required<Plugin.NovelItem>>();

  /**
   * Safely extract the pathname from any URL on {@link site}. Check the root
   * site as there are novels linking off-site (to Patreon).
   *
   * @private
   */
  getPath(url: string): string | undefined {
    if (!url.startsWith(this.site)) {
      return undefined;
    }
    const trimmed = url.substring(this.site.length).replace(/(^\/+|\/+$)/g, '');
    if (trimmed.length === 0) {
      return undefined;
    }
    return trimmed;
  }

  /**
   * Map an array with an asynchronous function and only return the array items
   * that successfully were fulfilled with values other than undefined.
   *
   * @private
   */
  async asyncMap<T, U>(
    collection: readonly T[],
    callbackfn: (value: T, index: number, array: readonly T[]) => Promise<U>,
  ): Promise<Exclude<U, undefined>[]> {
    return (await Promise.allSettled(collection.map(callbackfn)))
      .filter(
        <U>(
          p: PromiseSettledResult<U>,
        ): p is PromiseFulfilledResult<Exclude<U, undefined>> =>
          p.status === 'fulfilled' && p.value !== undefined,
      )
      .map(({ value }) => value);
  }

  /**
   * DDL links to future (unpublished) chapters from its novel pages. To be
   * able to report updates correctly, try to figure out which chapter was the
   * actual latest one to be published.
   *
   * @private
   * @returns the path value of the latest published chapter (or undefined)
   */
  async findLatestChapter(novelPath: string): Promise<string | undefined> {
    const link = `${this.site}wp-json/wp/v2/categories?slug=${novelPath}`;
    const guessCategory = await fetchApi(link).then(res => res.json());
    if (guessCategory.length !== 1) {
      return undefined;
    }
    const categoryId = guessCategory[0].id;
    const chapterLink = `${this.site}wp-json/wp/v2/posts?categories=${categoryId}&per_page=1`;
    const lastChapter = await fetchApi(chapterLink).then(res => res.json());
    if (lastChapter.length !== 1) {
      return undefined;
    }
    return lastChapter[0].slug;
  }

  /**
   * Based on the path, grab all the available information about a novel. Used
   * to seed the {@link novelItemCache} as well as to fetch the actual single
   * novel views with chapter list.
   *
   * @private
   */
  async grabNovel(
    path: string,
    getChapters = false,
  ): Promise<(Plugin.SourceNovel & Required<Plugin.NovelItem>) | undefined> {
    const body = await fetchApi(new URL(path, this.site).href).then(res =>
      res.text(),
    );
    const content = parseHTML(body);
    const name = content('h1.story__identity-title').text().trim();
    if (!name) return undefined;
    let chapters: Plugin.ChapterItem[] = [];
    if (getChapters) {
      chapters = content('li.chapter-group__list-item._publish')
        .filter((_, el) => !content(el).hasClass('_password'))
        .map((_, anchorEl) => {
          const anchor = content(anchorEl).find('a').first();
          const chapterPath = this.getPath(anchor.attr('href') || '');
          if (!chapterPath) return;
          return {
            name: anchor.text().trim(),
            path: chapterPath,
          } satisfies Plugin.ChapterItem;
        })
        .toArray();
    }
    return {
      name,
      path,
      cover:
        content('figure.story__thumbnail > a').attr('href') ??
        content('figure.story__thumbnail img').attr('src') ??
        defaultCover,
      author: content('section.story__summary')
        .text()
        .match(/Author:\s*([^\n]+)/i)?.[1]
        ?.trim(),
      summary: content('section.story__summary').text().trim(),
      chapters,
    };
  }

  /**
   * Based on the path, grab the {@link Plugin.NovelItem} information from the
   * cache. If not available in the cache, it will fetch the information.
   *
   * @private
   */
  async grabCachedNovel(path: string): Promise<Plugin.NovelItem | undefined> {
    const fromCache = this.novelItemCache.get(path);
    if (fromCache) {
      return fromCache;
    }
    const sourceNovel = await this.grabNovel(path, false);
    if (sourceNovel === undefined) {
      return undefined;
    }
    const novel = {
      name: sourceNovel.name,
      path: sourceNovel.path,
      cover: sourceNovel.cover,
    };
    this.novelItemCache.set(path, novel);
    return novel;
  }

  /**
   * Get the list of all novels listed on the novels page. Cache it so filters
   * do not have to refetch the same HTML again.
   *
   * @private
   */
  async grabCachedNovels(): Promise<
    readonly (readonly [string, string, string])[] | undefined
  > {
    if (this.allNovelsCache) {
      return this.allNovelsCache;
    }
    const body = await fetchApi(this.site + 'novels').then(res => res.text());
    const loadedCheerio = parseHTML(body);
    const categoryMap: Record<string, string> = {
      'Ongoing Novels': 'Translating',
      'Completed Novels': 'Completed',
      'Dropped Novels': 'Dropped',
    };
    const novels = loadedCheerio('a[href*="/story/"]')
      .map((_, anchorEl) => {
        const anchor = loadedCheerio(anchorEl);
        const path = this.getPath(anchor.attr('href') || '');
        if (!path) return;
        const card = anchor.closest('.card');
        const heading = card.find('h3.card__title').first().text().trim();
        const category = categoryMap[heading] || 'Translating';
        return [[category, anchor.text().trim(), path]] as const;
      })
      .toArray();
    const unique = Array.from(
      new Map(novels.map(novel => [novel[2], novel])).values(),
    );
    this.allNovelsCache = unique;
    return unique;
  }

  /**
   * Parse list of paths of recently updated novels from the homepage.
   *
   * @private
   */
  async latestNovels(): Promise<readonly string[]> {
    const body = await fetchApi(this.site).then(res => res.text());
    const loadedCheerio = parseHTML(body);
    const novelPaths = loadedCheerio('#main')
      .find('a[rel="category tag"]')
      .map((_, anchorEl) => {
        const path = this.getPath(anchorEl.attribs['href']);
        return path;
      })
      .toArray();
    const uniqueNovelPaths = new Set(novelPaths);
    return Array.from(uniqueNovelPaths);
  }

  /**
   * Parse list of paths from novels list, optionally filtered.
   *
   * @private
   */
  async allNovels(
    categoryFilter: FilterValueWithType<FilterTypes.CheckboxGroup>,
  ) {
    const allNovels = await this.grabCachedNovels();
    if (!allNovels) return [];
    return allNovels
      .filter(([category]) => categoryFilter.value.includes(category))
      .map(([, , path]) => path);
  }

  async popularNovels(
    pageNo: number,
    options: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    if (pageNo !== 1) {
      return [];
    }
    const novelsList = options.showLatestNovels
      ? this.latestNovels()
      : this.allNovels(options.filters.category);
    return await this.asyncMap(
      await novelsList,
      this.grabCachedNovel.bind(this),
    );
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const sourceNovel = await this.grabNovel(novelPath, true);
    if (sourceNovel === undefined) {
      throw new Error(`The path "${novelPath}" could not be resolved.`);
    }
    return sourceNovel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const body = await fetchApi(new URL(chapterPath, this.site).href).then(
      res => res.text(),
    );
    return parseHTML(body)('section#chapter-content > div').html() || '';
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    if (pageNo !== 1) {
      return [];
    }
    const allNovels = await this.grabCachedNovels();
    if (!allNovels) return [];
    const foundNovels = allNovels
      .filter(([, name]) =>
        name.toLocaleLowerCase().includes(searchTerm.toLocaleLowerCase()),
      )
      .map(([, , path]) => path);
    return await this.asyncMap(foundNovels, this.grabCachedNovel.bind(this));
  }
}

export default new DDLPlugin();

