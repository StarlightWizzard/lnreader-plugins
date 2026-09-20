import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { NovelStatus } from '@libs/novelStatus';

type NovelRow = {
  id: string;
  title: string;
  author_name?: string;
  synopsis?: string;
  cover_url?: string;
  genres?: string[];
  status?: string;
  slug: string;
};

type ChapterRow = {
  id: string;
  number: number;
  title?: string;
  content?: string;
  published_at?: string;
};

class WordExcerpt implements Plugin.PluginBase {
  id = 'wordexcerpt';
  name = 'WordExcerpt';
  site = 'https://wordexcerpt.com';
  icon = 'multisrc/madara/wordexcerpt/icon.png';
  version = '2.0.0';

  private api = 'https://debebcxopcfhukeqweco.supabase.co/rest/v1';
  private apiKey =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRlYmViY3hvcGNmaHVrZXF3ZWNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2OTY4NjQsImV4cCI6MjA4NjI3Mjg2NH0._DMgqDOhgT2Z9l4gd0aeCV4dXBARZWRabYDd8__BgEM';

  private async query<T>(table: string, params: URLSearchParams): Promise<T> {
    const response = await fetchApi(`${this.api}/${table}?${params}`, {
      headers: {
        apikey: this.apiKey,
        Authorization: `Bearer ${this.apiKey}`,
      },
    });
    return response.json();
  }

  private novelItem(row: NovelRow): Plugin.NovelItem {
    return {
      name: row.title,
      path: `/novel/${row.slug}`,
      cover: row.cover_url,
    };
  }

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    const limit = 24;
    const params = new URLSearchParams({
      select: 'id,title,cover_url,slug',
      status: 'neq.draft',
      order: 'updated_at.desc',
      limit: String(limit),
      offset: String((pageNo - 1) * limit),
    });
    return (await this.query<NovelRow[]>('novels', params)).map(row =>
      this.novelItem(row),
    );
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    const limit = 24;
    const params = new URLSearchParams({
      select: 'id,title,cover_url,slug',
      status: 'neq.draft',
      title: `ilike.*${searchTerm.replace(/[*,]/g, '')}*`,
      order: 'updated_at.desc',
      limit: String(limit),
      offset: String((pageNo - 1) * limit),
    });
    return (await this.query<NovelRow[]>('novels', params)).map(row =>
      this.novelItem(row),
    );
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const slug = novelPath.split('/').filter(Boolean).pop()!;
    const novelParams = new URLSearchParams({
      select: 'id,title,author_name,synopsis,cover_url,genres,status,slug',
      slug: `eq.${slug}`,
      limit: '1',
    });
    const [novel] = await this.query<NovelRow[]>('novels', novelParams);
    if (!novel) throw new Error('Novel not found');

    const chapterParams = new URLSearchParams({
      select: 'id,number,title,published_at',
      novel_id: `eq.${novel.id}`,
      status: 'eq.published',
      order: 'number.asc',
      limit: '1000',
    });
    const chapters = await this.query<ChapterRow[]>('chapters', chapterParams);
    const statuses: Record<string, string> = {
      ongoing: NovelStatus.Ongoing,
      completed: NovelStatus.Completed,
      hiatus: NovelStatus.OnHiatus,
      dropped: NovelStatus.Cancelled,
    };

    return {
      name: novel.title,
      path: novelPath,
      author: novel.author_name,
      summary: novel.synopsis,
      cover: novel.cover_url,
      genres: novel.genres?.join(','),
      status:
        statuses[novel.status?.toLowerCase() || ''] || NovelStatus.Unknown,
      chapters: chapters.map(chapter => ({
        name: `Chapter ${chapter.number}${chapter.title ? `: ${chapter.title}` : ''}`,
        path: `/reader/${novel.id}/${chapter.id}`,
        chapterNumber: chapter.number,
        releaseTime: chapter.published_at,
      })),
    };
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const chapterId = chapterPath.split('/').filter(Boolean).pop()!;
    const params = new URLSearchParams({
      select: 'content',
      id: `eq.${chapterId}`,
      limit: '1',
    });
    const [chapter] = await this.query<ChapterRow[]>('chapters', params);
    return chapter?.content || '';
  }
}

export default new WordExcerpt();

