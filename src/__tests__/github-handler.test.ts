import GithubHandler, { parseRepoUrl } from '../handlers/GithubHandler';

jest.mock('../constants', () => ({
  GITHUB_CLIENT_ID: '',
  GITHUB_CLIENT_SECRET: '',
  GITHUB_REDIRECT_URI: '',
}));

describe('GithubHandler utility methods', () => {
  beforeEach(() => {
    (global as any).chrome = {
      storage: {
        sync: {
          get: jest.fn((keys: any, cb: any) => cb({})),
          set: jest.fn(),
          clear: jest.fn(),
        },
        local: {
          set: jest.fn(),
        },
      },
    };
  });

  it('parses an https repo url', () => {
    expect(parseRepoUrl('https://github.com/kumarankit0411/LeetcodeTracker')).toEqual({
      owner: 'kumarankit0411',
      repo: 'LeetcodeTracker',
    });
  });

  it('parses an https repo url ending in .git', () => {
    expect(parseRepoUrl('https://github.com/kumarankit0411/LeetcodeTracker.git')).toEqual({
      owner: 'kumarankit0411',
      repo: 'LeetcodeTracker',
    });
  });

  it('parses an ssh repo url', () => {
    expect(parseRepoUrl('git@github.com:kumarankit0411/LeetcodeTracker.git')).toEqual({
      owner: 'kumarankit0411',
      repo: 'LeetcodeTracker',
    });
  });

  it('parses a bare owner/repo string', () => {
    expect(parseRepoUrl('kumarankit0411/LeetcodeTracker')).toEqual({
      owner: 'kumarankit0411',
      repo: 'LeetcodeTracker',
    });
  });

  it('tolerates trailing slashes', () => {
    expect(parseRepoUrl('https://github.com/yoda/RepoName/')).toEqual({
      owner: 'yoda',
      repo: 'RepoName',
    });
  });

  it('returns null for invalid urls', () => {
    expect(parseRepoUrl('')).toBeNull();
    expect(parseRepoUrl('not-a-repo-url')).toBeNull();
    expect(parseRepoUrl('https://github.com/only-owner')).toBeNull();
  });

  it('returns correct file extension for a language', () => {
    const handler = new GithubHandler();
    expect(handler.getProblemExtension('Python')).toBe('.py');
    expect(handler.getProblemExtension('JavaScript')).toBe('.js');
  });

  it('returns correct difficulty color', () => {
    const handler = new GithubHandler();
    expect(handler.getDifficultyColor('Easy')).toBe('brightgreen');
    expect(handler.getDifficultyColor('Medium')).toBe('orange');
    expect(handler.getDifficultyColor('Hard')).toBe('red');
  });

  it('creates a difficulty badge using the difficulty color', () => {
    const handler = new GithubHandler();
    const badge = handler.createDifficultyBadge('Medium');
    expect(badge).toContain('img');
    expect(badge).toContain('Difficulty-Medium-orange');
  });

  it('loads token from storage', async () => {
    const handler = new GithubHandler();
    (global as any).chrome.storage.sync.get = jest.fn((keys: any, cb: any) => cb({ github_leetsync_token: 'abc' }));
    const token = await handler.loadTokenFromStorage();
    expect(token).toBe('abc');
  });

  it('returns empty string and clears storage when token missing', async () => {
    const clear = jest.fn();
    (global as any).chrome.storage.sync.get = jest.fn((keys: any, cb: any) => cb({}));
    (global as any).chrome.storage.sync.clear = clear;
    const handler = new GithubHandler();
    const token = await handler.loadTokenFromStorage();
    expect(token).toBe('');
    expect(clear).toHaveBeenCalled();
  });
});
