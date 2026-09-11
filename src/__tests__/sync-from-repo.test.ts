import { syncProblemsFromRepo } from '../lib/syncFromRepo';

const encode = (value: string) => Buffer.from(value, 'utf-8').toString('base64');

const readme = (difficulty: string, title: string) =>
  `<h2><a href="https://leetcode.com/problems/${title}">${title}</a></h2> <img src='https://img.shields.io/badge/Difficulty-${difficulty}-brightgreen' alt='Difficulty: ${difficulty}' /><hr>problem statement`;

describe('syncProblemsFromRepo', () => {
  let syncData: Record<string, any>;
  let localData: Record<string, any>;

  const mockGithubResponses = (tree: Record<string, string[]>) => {
    const treeEntries: { path: string; type: 'blob' | 'tree' }[] = [];
    Object.entries(tree).forEach(([dir, files]) => {
      treeEntries.push({ path: dir, type: 'tree' });
      files.forEach((file) => treeEntries.push({ path: `${dir}/${file}`, type: 'blob' }));
    });
    treeEntries.push({ path: 'README.md', type: 'blob' });

    (global as any).fetch = jest.fn(async (url: string) => {
      const withQuery = new URL(url);
      const pathname = withQuery.pathname;
      const searchParams = withQuery.searchParams;

      const json = (body: unknown) =>
        ({ ok: true, json: async () => body, status: 200 }) as Response;

      if (pathname === '/repos/username/my-solutions') {
        return json({ default_branch: 'main' });
      }
      if (
        pathname === '/repos/username/my-solutions/git/trees/main' &&
        searchParams.get('recursive') === '1'
      ) {
        return json({ tree: treeEntries });
      }
      const contentsMatch = pathname.match(
        /\/repos\/username\/my-solutions\/contents\/(.+?)\/README\.md/,
      );
      if (contentsMatch) {
        const title = contentsMatch[1].split('/').pop() || '';
        const match = title.match(/^(\d+)-([a-z0-9-]+)$/);
        const id = Number(match?.[1]) || 0;
        const difficulty = id < 5 ? 'Easy' : id < 20 ? 'Medium' : 'Hard';
        return json({ content: encode(readme(difficulty, match?.[2] || '')) });
      }
      if (pathname === '/repos/username/my-solutions/commits') {
        const dir = searchParams.get('path') || '';
        const dayOffset = dir
          .split('/')
          .pop()
          ?.match(/^(\d+)-/)?.[1]
          ? Number(
              dir
                .split('/')
                .pop()
                ?.match(/^(\d+)-/)?.[1],
            )
          : 0;
        return json([
          {
            commit: {
              author: {
                date: new Date(Date.UTC(2024, 0, 1 + (dayOffset % 3))).toISOString(),
              },
            },
          },
        ]);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
  };

  beforeEach(() => {
    syncData = {
      github_username: 'username',
      github_leetsync_repo: 'my-solutions',
      github_leetsync_token: 'token',
    };
    localData = {};

    (global as any).chrome = {
      storage: {
        local: {
          get: jest.fn(async (keys) =>
            Array.isArray(keys)
              ? keys.reduce((acc: any, k: string) => ({ ...acc, [k]: localData[k] }), {})
              : { [keys]: localData[keys] },
          ),
          set: jest.fn(async (items) => Object.assign(localData, items)),
          remove: jest.fn(),
        },
        sync: {
          get: jest.fn(async (keys) =>
            Array.isArray(keys)
              ? keys.reduce((acc: any, k: string) => ({ ...acc, [k]: syncData[k] }), {})
              : { [keys]: syncData[keys] },
          ),
          set: jest.fn(async (items) => Object.assign(syncData, items)),
          remove: jest.fn(),
        },
      },
      runtime: {},
    };
  });

  it('syncs previously solved problems from the repo into local storage', async () => {
    mockGithubResponses({
      '1-two-sum': ['README.md', 'two-sum.py', 'Notes.md'],
      '10-regular-expression-matching': ['README.md', 'regular-expression-matching.cpp'],
    });

    const result = await syncProblemsFromRepo();

    expect(result.totalRepoProblems).toBe(2);
    expect(result.added).toBe(2);
    expect(result.alreadyTracked).toBe(0);
    expect(result.failed).toBe(0);

    const stored = localData.problemsSolved;
    expect(stored['two-sum'].question.difficulty).toBe('Easy');
    expect(stored['two-sum'].question.questionId).toBe('1');
    expect(typeof stored['two-sum'].timestamp).toBe('number');
    expect(stored['regular-expression-matching'].question.difficulty).toBe('Medium');
    expect(stored['regular-expression-matching'].question.questionId).toBe('10');
  });

  it('keeps already tracked problems untouched', async () => {
    mockGithubResponses({ '1-two-sum': ['README.md', 'two-sum.py'] });
    localData.problemsSolved = {
      'two-sum': {
        question: { difficulty: 'Easy', questionId: 1 },
        timestamp: 1700000000000,
      },
    };

    const result = await syncProblemsFromRepo();

    expect(result.added).toBe(0);
    expect(result.alreadyTracked).toBe(1);
    expect(localData.problemsSolved['two-sum'].timestamp).toBe(1700000000000);
  });

  it('throws when GitHub credentials are missing', async () => {
    syncData = {};

    await expect(syncProblemsFromRepo()).rejects.toThrow(/credentials not found/i);
  });

  it('reports reading progress as problems are processed', async () => {
    mockGithubResponses({
      '1-two-sum': ['README.md', 'two-sum.py'],
      '2-add-two-numbers': ['README.md', 'add-two-numbers.py'],
      '10-regular-expression-matching': ['README.md', 'regular-expression-matching.cpp'],
    });

    const progress: string[] = [];
    await syncProblemsFromRepo((status) => {
      progress.push(status.stage);
      if (status.stage === 'reading') {
        progress.push(`${status.processed}/${status.total}`);
      }
    });

    expect(progress).toContain('listing');
    expect(progress).toContain('1/3');
    expect(progress).toContain('2/3');
    expect(progress).toContain('3/3');
    expect(progress).toContain('saving');
    expect(progress).toContain('done');
  });
});
