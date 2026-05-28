'use client';

import { useState } from 'react';
import { LayoutTemplate } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Card } from '@/components/ui/card';
import { EMAIL_TEMPLATES, type EmailTemplate } from './email-templates';

interface Props {
  onPick: (template: EmailTemplate) => void;
  /**
   * Codex #22 P3 (2026-05-28): the parent form passes this when it
   * has dirty content; the gallery then routes the pick through a
   * confirm dialog instead of silently overwriting. False (default)
   * skips the confirm so empty-form picks are one-click.
   */
  hasUnsavedContent?: boolean;
}

/**
 * Task #22 (2026-05-28): a gallery of canned starter templates. Local
 * to the Compose form — clicking a template pre-fills the subject and
 * body so admins don't start from a blank screen.
 *
 * Replaces nothing yet — this is an additive helper. The Compose form
 * still works without it.
 */
export function TemplateGalleryDialog({ onPick, hasUnsavedContent = false }: Props) {
  const [open, setOpen] = useState(false);
  const [pendingTemplate, setPendingTemplate] = useState<EmailTemplate | null>(null);

  function handlePick(template: EmailTemplate) {
    if (hasUnsavedContent) {
      setPendingTemplate(template);
      return;
    }
    onPick(template);
    setOpen(false);
  }

  function confirmReplace() {
    if (pendingTemplate) {
      onPick(pendingTemplate);
      setPendingTemplate(null);
      setOpen(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <LayoutTemplate className="mr-2 h-4 w-4" />
            Start from a template
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Pick a template</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {EMAIL_TEMPLATES.map((template) => (
              <Card
                key={template.id}
                className="hover:bg-accent cursor-pointer p-4 transition-colors"
                onClick={() => handlePick(template)}
              >
                <h4 className="font-semibold">{template.label}</h4>
                <p className="text-muted-foreground mt-1 text-sm">{template.description}</p>
              </Card>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingTemplate !== null}
        onOpenChange={(o) => !o && setPendingTemplate(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace your draft?</AlertDialogTitle>
            <AlertDialogDescription>
              Loading &ldquo;{pendingTemplate?.label}&rdquo; will overwrite what you&apos;ve
              already written in the subject and body.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep my draft</AlertDialogCancel>
            <AlertDialogAction onClick={confirmReplace}>Replace with template</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
