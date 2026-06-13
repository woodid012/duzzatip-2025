import { redirect } from 'next/navigation';

// The app's home is the results page. Redirect on the server so visitors land
// there immediately, with no flash of an intermediate landing screen.
export default function Home() {
  redirect('/pages/results');
}
