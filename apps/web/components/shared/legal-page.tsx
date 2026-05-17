import Link from 'next/link';

interface LegalPageProps {
  title: string;
  effectiveDate: string;
  lastUpdated: string;
  summary?: string;
  children: React.ReactNode;
}

export function LegalPage({
  title,
  effectiveDate,
  lastUpdated,
  summary,
  children,
}: LegalPageProps) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <header className="mb-10 border-b pb-8">
        <p className="text-muted-foreground text-sm font-medium uppercase tracking-wide">Legal</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
        <dl className="text-muted-foreground mt-4 grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
          <div>
            <dt className="inline font-medium">Effective: </dt>
            <dd className="inline">{effectiveDate}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Last updated: </dt>
            <dd className="inline">{lastUpdated}</dd>
          </div>
        </dl>
        {summary ? (
          <p className="text-muted-foreground mt-6 max-w-prose rounded-lg border bg-muted/30 p-4 text-sm leading-relaxed">
            <strong className="text-foreground">In short: </strong>
            {summary}
          </p>
        ) : null}
      </header>

      <div className="prose prose-neutral max-w-none [&_a]:underline [&_a]:underline-offset-2 [&_h2]:mt-10 [&_h2]:scroll-mt-24 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-6 [&_h3]:text-base [&_h3]:font-semibold [&_li]:my-1 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-4 [&_p]:leading-relaxed [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6">
        {children}
      </div>

      <footer className="mt-16 border-t pt-8">
        <p className="text-muted-foreground text-sm">
          Questions about this page? Email{' '}
          <a href="mailto:info@cavaliq.com" className="text-foreground underline">
            info@cavaliq.com
          </a>{' '}
          or visit{' '}
          <Link href="/support" className="text-foreground underline">
            Support
          </Link>
          .
        </p>
      </footer>
    </article>
  );
}
