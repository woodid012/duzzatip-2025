import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { isDuzzaFinalsWindow } from './lib/duzzaFinalsWindow';
import { AUTH_COOKIE, verifySession } from './lib/auth';

// The app's home is the results page — except while Duzza Finals is running,
// when a finals interface takes over as the default landing page. Which one
// depends on who's knocking: a core team (main-app session) gets the full core
// app, everyone else — pool entrants, whose PWA start_url is also '/' — gets
// the standalone /finals mini-app, which signs them in off their own cookie
// (or saved creds) with no core login to fail on. Redirect on the server so
// visitors land there immediately, with no flash of an intermediate screen.
export const dynamic = 'force-dynamic';

export default async function Home() {
  if (!isDuzzaFinalsWindow()) redirect('/pages/results');

  const token = (await cookies()).get(AUTH_COOKIE)?.value;
  redirect(verifySession(token) ? '/pages/duzza-finals' : '/finals');
}
