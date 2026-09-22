import { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_REDIRECT_URI } from '../constants';
import { getProblemsSolved, saveProblemsSolved } from '../lib/problemsSolvedStorage';
import { QuestionDifficulty } from '../types/Question';
import { Submission } from '../types/Submission';

type DistributionType = {
  percentile: string;
  value: number;
};

const bodyIsBadCredentials = (body: unknown): boolean =>
  typeof body === 'object' && body !== null && (body as any)?.message === 'Bad credentials';

// A 401 "Bad credentials" means the stored OAuth token was revoked or has
// expired. Flag it so the UI can prompt re-authorization, and invalidate the
// stale token without wiping the rest of the user's settings.
const markAuthExpired = async (): Promise<void> => {
  await chrome.storage.sync.remove('github_leetsync_token');
  await chrome.storage.sync.set({
    github_auth_expired: true,
    github_auth_expired_at: Date.now(),
  });
};

export const getGithubAuthUrl = (): string => {
  return `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${GITHUB_REDIRECT_URI}&scope=repo`;
};

const languagesToExtensions: Record<string, string> = {
  Python: '.py',
  Python3: '.py',
  'C++': '.cpp',
  C: '.c',
  Java: '.java',
  'C#': '.cs',
  JavaScript: '.js',
  Javascript: '.js',
  Ruby: '.rb',
  Swift: '.swift',
  Go: '.go',
  Kotlin: '.kt',
  Scala: '.scala',
  Rust: '.rs',
  PHP: '.php',
  TypeScript: '.ts',
  MySQL: '.sql',
  'MS SQL Server': '.sql',
  Oracle: '.sql',
  PostgreSQL: '.sql',
  'C++14': '.cpp',
  'C++17': '.cpp',
  'C++11': '.cpp',
  'C++98': '.cpp',
  'C++03': '.cpp',
  'C++20': '.cpp',
  'C++1z': '.cpp',
  'C++1y': '.cpp',
  'C++1x': '.cpp',
  'C++1a': '.cpp',
  CPP: '.cpp',
  Dart: '.dart',
  Elixir: '.ex',
};
interface GithubUser {
  id: number;
  avatar_url?: string | null;
  url: string;
  login: string;
  /* other user data can be added here, but not needed for now */
}

export type RepoUrlInfo = {
  owner: string;
  repo: string;
};

export const parseRepoUrl = (url: string): RepoUrlInfo | null => {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) return null;

  let owner: string | undefined;
  let repo: string | undefined;

  const httpsMatch = trimmed.match(/^https?:\/\/[^/]+\/([^/]+)\/([^/]+)$/);
  const sshMatch = trimmed.match(/^git@[^:]+:([^/]+)\/(.+)$/);

  if (httpsMatch) {
    owner = httpsMatch[1];
    repo = httpsMatch[2];
  } else if (sshMatch) {
    owner = sshMatch[1];
    repo = sshMatch[2];
  } else if (!trimmed.includes('://') && !trimmed.startsWith('git@')) {
    const parts = trimmed.split('/');
    if (parts.length === 2 && parts[0] && parts[1]) {
      owner = parts[0];
      repo = parts[1];
    }
  }

  if (!owner || !repo) return null;
  repo = repo.replace(/\.git$/i, '');
  if (!owner || !repo) return null;
  return { owner, repo };
};
export default class GithubHandler {
  base_url: string = 'https://api.github.com';
  private client_secret: string | null = GITHUB_CLIENT_SECRET ?? '';
  private client_id: string | null = GITHUB_CLIENT_ID ?? '';
  private redirect_uri: string | null = GITHUB_REDIRECT_URI ?? '';
  private accessToken: string;
  private username: string;
  private repoOwner: string;
  private repo: string;
  private github_leetsync_subdirectory: string;

  constructor() {
    //fetch github_access_token, github_username, github_leetsync_repo from storage
    //if any of them is not present, throw an error
    this.accessToken = '';
    this.username = '';
    this.repoOwner = '';
    this.repo = '';
    this.github_leetsync_subdirectory = '';

    chrome.storage.sync.get(
      [
        'github_leetsync_token',
        'github_username',
        'github_leetsync_repo',
        'github_leetsync_owner',
        'github_leetsync_subdirectory',
      ],
      (result) => {
        if (
          !result.github_leetsync_token ||
          !result.github_leetsync_repo
        ) {
          console.log('❌ GithubHandler: Missing Github Credentials');
        }
        this.accessToken = result['github_leetsync_token'];
        this.username = result['github_username'];
        this.repoOwner =
          result['github_leetsync_owner'] ?? result['github_leetsync_repo']?.split('/')[0];
        this.repo = (result['github_leetsync_repo'] ?? '').split('/').pop()?.replace(/\.git$/i, '');
        this.github_leetsync_subdirectory = result['github_leetsync_subdirectory'];
      },
    );
  }

  private getOwnerForRepoPath(): string {
    return this.repoOwner || this.username;
  }

  private getRepoContentsPath(path: string, fileName: string): string {
    return `https://api.github.com/repos/${this.getOwnerForRepoPath()}/${this.repo}/contents/${path}/${fileName}`;
  }
  async loadTokenFromStorage(): Promise<string> {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.get(['github_leetsync_token'], (result) => {
        const token = result['github_leetsync_token'];
        if (!token) {
          console.log('No access token found.');
          chrome.storage.sync.clear();
          resolve('');
        }
        resolve(token);
      });
    });
  }
  async authorize(code: string): Promise<string | null> {
    const access_token = await this.fetchAccessToken(code);
    const user = await this.fetchGithubUser(access_token);
    if (!access_token || !user) return null;
    this.accessToken = access_token;
    this.username = user.login;
    await chrome.storage.sync.remove('github_auth_expired');
    return access_token;
  }
  async fetchGithubUser(token: string): Promise<GithubUser | null> {
    //validate the token
    const response = await fetch(`${this.base_url}/user`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `token ${token}`,
      },
    }).then((response) => response.json());

    if (!response || response.message === 'Bad credentials') {
      console.error('No access token found.');
      chrome.storage.sync.clear();
      return null;
    }

    //set access token in chrome storage
    chrome.storage.sync.set({
      github_leetsync_token: token,
      github_username: response.login,
    });
    return response;
  }
  async fetchAccessToken(code: string) {
    const token = await this.loadTokenFromStorage();

    if (token) return token;

    const tokenUrl = 'https://github.com/login/oauth/access_token';
    const body = {
      code,
      client_id: this.client_id,
      redirect_uri: this.redirect_uri,
      client_secret: this.client_secret,
    };
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    }).then((response) => response.json());

    if (!response || response.message === 'Bad credentials') {
      console.log('No access token found.');
      chrome.storage.sync.clear();
      return;
    }

    chrome.storage.sync.set({ github_leetsync_token: response.access_token }, () => {
      console.log('Saved github access token.');
    });
    return response.access_token;
  }
  private lastRepoCheckError: string | null = null;

  getRepoCheckError(): string | null {
    return this.lastRepoCheckError;
  }

  async checkIfRepoExists(repo_name: string): Promise<boolean> {
    this.lastRepoCheckError = null;
    const trimmedRepoName = repo_name.replace(/\.git$/i, '').trim().replace(/\/+$/, '');
    if (!trimmedRepoName) return false;
    //check if repo exists in github user's account
    try {
      const response = await fetch(`${this.base_url}/repos/${trimmedRepoName}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `token ${await this.loadTokenFromStorage()}`,
        },
      });
      const body = await response.json().catch(() => null);
      if (response.status === 404) {
        this.lastRepoCheckError = 'Repository not found';
        return false;
      }
      if (response.status === 401 && bodyIsBadCredentials(body)) {
        this.lastRepoCheckError =
          'Your GitHub token is invalid or expired. Please re-authenticate with GitHub and try again.';
        await markAuthExpired();
        return false;
      }
      if (!response.ok) {
        this.lastRepoCheckError = `GitHub API error (${response.status})`;
        console.error('⚠️ Could not verify repository:', response.status, body);
        return false;
      }
      return true;
    } catch (e) {
      console.error(e);
      this.lastRepoCheckError = 'Could not reach GitHub API';
      return false;
    }
  }
  public getProblemExtension(lang: string) {
    return languagesToExtensions[lang];
  }

  /* Submissions Methods */
  async fileExists(path: string, fileName: string): Promise<string | null> {
    //check if the file exists in the path using the github API
    const url = this.getRepoContentsPath(path, fileName);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
      });
    } catch (err) {
      throw new Error(`Could not reach GitHub API: ${err instanceof Error ? err.message : err}`);
    }

    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(
        `GitHub API error (${response.status}): ${(body as any)?.message ?? response.statusText}`,
      );
    }
    const uploadedFile = await response.json();
    return uploadedFile.sha ?? null;
  }
  async upload(path: string, fileName: string, content: string, commitMessage: string) {
    const sha = await this.fileExists(path, fileName);
    //create a new file with the content
    const url = this.getRepoContentsPath(path, fileName);
    const data = {
      message: commitMessage,
      content: btoa(unescape(encodeURIComponent(content))),
      ...(sha ? { sha } : {}), //if the file already exists, we need to pass the sha of the file otherwise it will be null
    };

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });
    } catch (err) {
      throw new Error(`Could not reach GitHub API: ${err instanceof Error ? err.message : err}`);
    }

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const message = (body as any)?.message ?? `GitHub API responded with ${response.status}`;
      throw new Error(`Upload failed for ${path}/${fileName} (${response.status}): ${message}`);
    }
    return body;
  }
  getDifficultyColor(difficulty: QuestionDifficulty) {
    switch (difficulty) {
      case 'Easy':
        return 'brightgreen';
      case 'Medium':
        return 'orange';
      case 'Hard':
        return 'red';
    }
  }
  createDifficultyBadge(difficulty: QuestionDifficulty) {
    return `<img src='https://img.shields.io/badge/Difficulty-${difficulty}-${this.getDifficultyColor(
      difficulty,
    )}' alt='Difficulty: ${difficulty}' />`;
  }
  async createReadmeFile(
    path: string,
    content: string,
    message: string,
    problemSlug: string,
    questionTitle: string,
    difficulty: QuestionDifficulty,
  ) {
    //check if that file already exists
    //if it does, Update the file with the new content
    //if it doesn't, create a new file with the content
    const mdContent = `<h2><a href="https://leetcode.com/problems/${problemSlug}">${questionTitle}</a></h2> ${this.createDifficultyBadge(
      difficulty,
    )}<hr>${content}`;

    await this.upload(path, 'README.md', mdContent, message);
  }
  async createNotesFile(path: string, notes: string, message: string, questionTitle: string) {
    //check if that file already exists
    //if it does, Update the file with the new content
    //if it doesn't, create a new file with the content
    const mdContent = `<h2>${questionTitle} Notes</h2><hr>${notes}`;

    await this.upload(path, 'Notes.md', mdContent, message);
  }
  async createSolutionFile(
    path: string,
    code: string,
    problemName: string, //the code
    lang: string, //.py, .cpp, .java etc
    stats: {
      memory: number;
      memoryDisplay: string;
      memoryPercentile: number;
      runtime: number;
      runtimeDisplay: string;
      runtimePercentile: number;
    },
  ) {
    //check if that file already exists
    //if it does, Update the file with the new content
    //if it doesn't, create a new file with the content
    const msg = `Time: ${stats.runtimeDisplay} (${stats.runtimePercentile.toFixed(2)}%) | Memory: ${
      stats.memoryDisplay
    } (${stats.memoryPercentile.toFixed(2)}%) - LeetSync`;
    await this.upload(path, `${problemName}${lang}`, code, msg);
  }

  async submit(
    submission: Submission, //todo: define the submission type
  ): Promise<boolean> {
    if (!this.accessToken || !this.repo || !(this.username || this.repoOwner)) return false;
    const {
      code,
      memory,
      memoryDisplay,
      memoryPercentile,
      runtime,
      runtimePercentile,
      runtimeDisplay,
      runtimeDistribution,
      lang,
      statusCode,
      question,
      notes,
    } = submission;

    if (statusCode !== 10) {
      //failed submission
      console.log('❌ Failed Attempt');
      return false;
    }
    //create a path for the files to be uploaded
    let basePath = `${question.questionFrontendId ?? question.questionId ?? 'unknown'}-${question.titleSlug}`;

    if (this.github_leetsync_subdirectory) {
      basePath = `${this.github_leetsync_subdirectory}/${basePath}`;
    }

    const { title, titleSlug, content, difficulty, questionId } = question;

    const langExtension = this.getProblemExtension(lang.verboseName);

    if (!langExtension) {
      console.log('❌ Language not supported');
      return false;
    }

    const recordLocally = async () => {
      const todayTimestamp = Date.now();
      await chrome.storage.local.set({
        lastSolved: { slug: titleSlug, timestamp: todayTimestamp },
      });
      const problemsSolved = await getProblemsSolved(); //{slug: {...info}}
      await saveProblemsSolved({
        ...problemsSolved,
        [titleSlug]: {
          question: {
            difficulty,
            questionId,
          },
          timestamp: todayTimestamp,
        },
      });
    };

    try {
      await this.createReadmeFile(
        basePath,
        content,
        `Added README.md file for ${title}`,
        titleSlug,
        title,
        difficulty,
      );
      if (notes && notes?.length) {
        await this.createNotesFile(basePath, notes, `Added Notes.md file for ${title}`, titleSlug);
      }

      await this.createSolutionFile(basePath, code, question.titleSlug, langExtension, {
        memory,
        memoryDisplay,
        memoryPercentile,
        runtime,
        runtimeDisplay,
        runtimePercentile,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('❌ Failed to push solution to GitHub:', message);
      await chrome.storage.local.set({
        github_sync_error: {
          message,
          at: Date.now(),
          slug: titleSlug,
        },
      });
      // keep the local tracking intact even though the push failed
      await recordLocally();
      return false;
    }

    //create a new solution file with the code inside the folder
    await recordLocally();
    return true;
  }
}
