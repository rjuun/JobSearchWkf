import { redirect } from 'next/navigation';

export default function HomePage() {
  // Career-Graph-first IA (redesign_2): the graph is home base, not the board.
  redirect('/profile');
}
