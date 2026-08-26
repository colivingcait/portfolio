import { redirect } from 'next/navigation';

/**
 * Review was the register filtered to uncategorized rows, with the tools for
 * filing one attached. It is now the register itself, filtered the same way —
 * so a bank line is in one place whatever state it is in, instead of moving
 * between two screens the moment it gets a category.
 *
 * The route stays as a redirect: it was linked from half the explainers, and a
 * bookmark that used to work should keep working.
 */
export default function ReviewPage() {
  redirect('/books?state=uncategorized');
}
