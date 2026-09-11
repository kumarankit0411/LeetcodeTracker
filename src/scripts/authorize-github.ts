import { GithubHandler } from '../handlers';
import { GITHUB_REDIRECT_URI } from '../constants';

const github = new GithubHandler();

try {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const referrer = url.searchParams.get('referrer');
  const expectedReferrer = new URL(GITHUB_REDIRECT_URI).searchParams.get('referrer');
  if (code && referrer === expectedReferrer) {
    github.authorize(code);
  }
} catch (e) {
  console.error(e);
}
