import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

interface HelpArticleProps {
  title: string;
  description: string;
  children: React.ReactNode;
}

export function HelpArticle({ title, description, children }: HelpArticleProps) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <Link
        href="/help"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to help centre
      </Link>
      <header className="mt-6 border-b pb-8">
        <p className="text-muted-foreground text-sm font-medium uppercase tracking-wide">
          Help centre
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
        <p className="text-muted-foreground mt-4 max-w-prose text-base leading-relaxed">
          {description}
        </p>
      </header>

      <div className="prose prose-neutral mt-8 max-w-none [&_a]:underline [&_a]:underline-offset-2 [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-6 [&_h3]:text-base [&_h3]:font-semibold [&_li]:my-1 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-4 [&_p]:leading-relaxed [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6">
        {children}
      </div>

      <footer className="mt-16 border-t pt-8">
        <p className="text-muted-foreground text-sm">
          Still stuck?{' '}
          <Link href="/support" className="text-foreground underline">
            Contact support
          </Link>{' '}
          — we&rsquo;ll come back to you within one business day.
        </p>
      </footer>
    </article>
  );
}
