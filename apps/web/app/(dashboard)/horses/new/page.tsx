import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HorseForm } from '@/components/horses/horse-form';

export default function NewHorsePage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/horses">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Add Horse</h1>
          <p className="mt-1 text-muted-foreground">Add a new horse to your stable</p>
        </div>
      </div>
      <HorseForm />
    </div>
  );
}
