import { redirect } from 'next/navigation';
import { isDuzzaFinalsWindow } from './lib/duzzaFinalsWindow';

// The app's home is the results page — except while Duzza Finals is running,
// when the finals interface takes over as the default landing page. Redirect
// on the server so visitors land there immediately, with no flash of an
// intermediate landing screen.
export const dynamic = 'force-dynamic';

export default function Home() {
  redirect(isDuzzaFinalsWindow() ? '/pages/duzza-finals' : '/pages/results');
}
