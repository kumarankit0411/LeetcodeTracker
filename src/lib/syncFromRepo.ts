import { getProblemsSolved, saveProblemsSolved, ProblemsSolvedMap } from './problemsSolvedStorage';

export interface SyncFromRepoResult {
  totalRepoProblems: number;
  added: number;
  alreadyTracked: number;
  failed: number;
  errors: string[];
}

export type SyncProgress =
  | { stage: 'listing' }
  | { stage: 'reading'; processed: number; failed: number; total: number }
  | { stage: 'saving' }
  | { stage: 'done' };

interface GithubCredentials {
  username: string;
  repo: string;
  token: string;
}

interface RepoTreeEntry {
  path: string;
  type: 'blob' | 'tree';
}

interface PendingProblem {
  slug: string;
  questionId: string;
  path: string;
}

interface FetchedProblem {
  slug: string;
  questionId: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  timestamp: number;
}

const API_BASE = 'https://api.github.com';
const PROBLEM_DIR_PATTERN = /^(\d+)-([a-z0-9-]+)$/;
const DIFFICULTY_BADGE = /Difficulty-(Easy|Medium|Hard)/;
const CONCURRENCY = 4;

const decodeBase64 = (content: string) => decodeURIComponent(escape(atob(content)));

const mapWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
};

const getGithubCredentials = async (): Promise<GithubCredentials | null> => {
  const result = await chrome.storage.sync.get([
    'github_username',
    'github_leetsync_repo',
    'github_leetsync_token',
  ]);
  if (!result.github_username || !result.github_leetsync_repo || !result.github_leetsync_token) {
    return null;
  }
  return {
    username: result.github_username,
    repo: result.github_leetsync_repo,
    token: result.github_leetsync_token,
  };
};

const fetchGithub = async <T>(pathname: string, token: string): Promise<T> => {
  const response = await fetch(`${API_BASE}${pathname}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API responded with status ${response.status}`);
  }
  return response.json();
};

const listProblemDirectories = async (creds: GithubCredentials): Promise<PendingProblem[]> => {
  const repo = await fetchGithub<{ default_branch: string }>(
    `/repos/${creds.username}/${creds.repo}`,
    creds.token,
  );
  const tree = await fetchGithub<{ tree: RepoTreeEntry[] }>(
    `/repos/${creds.username}/${creds.repo}/git/trees/${repo.default_branch}?recursive=1`,
    creds.token,
  );
  const problems: PendingProblem[] = [];
  (tree.tree ?? []).forEach((entry) => {
    if (entry.type !== 'tree') return;
    const name = entry.path.split('/').pop() || '';
    const match = name.match(PROBLEM_DIR_PATTERN);
    if (!match) return;
    problems.push({ slug: match[2], questionId: match[1], path: entry.path });
  });
  return problems;
};

const fetchProblemDetails = async (
  creds: GithubCredentials,
  problem: PendingProblem,
): Promise<FetchedProblem> => {
  const readme = await fetchGithub<{ content: string }>(
    `/repos/${creds.username}/${creds.repo}/contents/${problem.path}/README.md`,
    creds.token,
  );
  const difficultyMatch = decodeBase64(readme.content).match(DIFFICULTY_BADGE);
  if (!difficultyMatch) {
    throw new Error(`No LeetSync difficulty badge found in README`);
  }

  const commits = await fetchGithub<Array<{ commit: { author: { date: string } } }>>(
    `/repos/${creds.username}/${creds.repo}/commits?path=${encodeURIComponent(
      problem.path,
    )}&per_page=1`,
    creds.token,
  );
  const timestamp = commits?.[0] ? new Date(commits[0].commit.author.date).getTime() : Date.now();

  return {
    slug: problem.slug,
    questionId: problem.questionId,
    difficulty: difficultyMatch[1] as 'Easy' | 'Medium' | 'Hard',
    timestamp,
  };
};

export const syncProblemsFromRepo = async (
  onStatus?: (status: SyncProgress) => void,
): Promise<SyncFromRepoResult> => {
  const creds = await getGithubCredentials();
  if (!creds) {
    throw new Error('GitHub credentials not found. Link your repository first.');
  }

  onStatus?.({ stage: 'listing' });
  const problems = await listProblemDirectories(creds);
  const existing = await getProblemsSolved();
  const result: SyncFromRepoResult = {
    totalRepoProblems: problems.length,
    added: 0,
    alreadyTracked: 0,
    failed: 0,
    errors: [],
  };

  let processed = 0;
  const details = await mapWithConcurrency(problems, CONCURRENCY, async (problem) => {
    try {
      const detail = await fetchProblemDetails(creds, problem);
      processed += 1;
      onStatus?.({ stage: 'reading', processed, failed: result.failed, total: problems.length });
      return detail;
    } catch (err) {
      result.failed += 1;
      processed += 1;
      onStatus?.({ stage: 'reading', processed, failed: result.failed, total: problems.length });
      result.errors.push(`${problem.slug}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  });

  const merged: ProblemsSolvedMap = { ...existing };
  details.forEach((detail) => {
    if (!detail) return;
    if (merged[detail.slug]) {
      result.alreadyTracked += 1;
      return;
    }
    merged[detail.slug] = {
      question: {
        difficulty: detail.difficulty,
        questionId: detail.questionId,
      },
      timestamp: detail.timestamp,
    };
    result.added += 1;
  });

  onStatus?.({ stage: 'saving' });
  await saveProblemsSolved(merged);
  onStatus?.({ stage: 'done' });
  return result;
};
