'use client';

import { OrganizationList } from '@clerk/nextjs';

export default function SelectOrgPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-md space-y-6 text-center">
        <div>
          <h1 className="text-2xl font-bold">Select a Club</h1>
          <p className="mt-2 text-muted-foreground">
            Choose a club to continue, or create a new one.
          </p>
        </div>
        <OrganizationList
          hidePersonal
          afterSelectOrganizationUrl="/"
          afterCreateOrganizationUrl="/"
        />
      </div>
    </div>
  );
}
