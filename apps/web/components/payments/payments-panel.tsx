'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { CheckCircle2, AlertCircle, Loader2, Link2, Unlink } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from '@/components/ui/form';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/shared/error-state';
import {
  type PaymentAccount,
  type PaymentProviderName,
  useConnectNGenius,
  useConnectStripe,
  useConnectZiina,
  useDisconnectProvider,
  usePaymentAccounts,
  useSetActiveProvider,
} from '@/hooks/use-payment-accounts';

// ─── Shared metadata per provider ─────────────────────────────────────

interface ProviderInfo {
  name: PaymentProviderName;
  displayName: string;
  tagline: string;
  connectMode: 'oauth' | 'api_key';
}

const PROVIDERS: readonly ProviderInfo[] = [
  {
    name: 'stripe',
    displayName: 'Stripe',
    tagline: 'Global card acceptance. Best for international riders and Apple/Google Pay.',
    connectMode: 'oauth',
  },
  {
    name: 'n_genius',
    displayName: 'N-Genius',
    tagline: 'Network International — UAE-dominant card acquirer with Mada support.',
    connectMode: 'api_key',
  },
  {
    name: 'ziina',
    displayName: 'Ziina',
    tagline: 'UAE fintech with fast onboarding and low-friction local payments.',
    connectMode: 'api_key',
  },
] as const;

// ─── Main panel ───────────────────────────────────────────────────────

export function PaymentsPanel() {
  const { data, isLoading, isError, error, refetch } = usePaymentAccounts();

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        {PROVIDERS.map((p) => (
          <Card key={p.name}>
            <CardContent className="p-6">
              <Skeleton className="mb-3 h-5 w-24" />
              <Skeleton className="mb-2 h-4 w-full" />
              <Skeleton className="h-9 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <ErrorState
        message={error instanceof Error ? error.message : 'Could not load payment accounts'}
        onRetry={() => refetch()}
      />
    );
  }

  const accounts = data?.success ? data.data : [];
  const byProvider = new Map(accounts.map((a) => [a.provider, a]));

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {PROVIDERS.map((info) => (
        <ProviderCard
          key={info.name}
          info={info}
          account={byProvider.get(info.name) ?? null}
        />
      ))}
    </div>
  );
}

// ─── Per-provider card ────────────────────────────────────────────────

interface ProviderCardProps {
  info: ProviderInfo;
  account: PaymentAccount | null;
}

function ProviderCard({ info, account }: ProviderCardProps) {
  const isConnected = account?.status === 'connected';
  const isActive = isConnected && account?.isActive;
  const hasError = account?.status === 'error';
  const isDisabled = account?.status === 'disabled';
  const isPlatformUnavailable = info.name === 'stripe' && !STRIPE_ENABLED;

  return (
    <Card
      className={
        isPlatformUnavailable
          ? 'border-muted bg-muted/20 opacity-75'
          : isActive
            ? 'border-green-200 bg-green-50/30'
            : hasError
              ? 'border-red-200 bg-red-50/30'
              : ''
      }
    >
      <CardHeader>
        <div className="flex items-start justify-between">
          <CardTitle className="text-lg">{info.displayName}</CardTitle>
          {isPlatformUnavailable ? (
            <Badge variant="outline" className="text-xs">Coming soon</Badge>
          ) : (
            <StatusBadge account={account} />
          )}
        </div>
        <CardDescription className="text-xs leading-relaxed">
          {info.tagline}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 pb-3">
        {isPlatformUnavailable && (
          <div className="text-xs text-muted-foreground">
            Stripe Connect is pending platform activation. Use N-Genius or Ziina in the meantime.
          </div>
        )}
        {account?.externalAccountId && (
          <div className="text-xs text-muted-foreground">
            <span className="font-medium">Account:</span>{' '}
            <code className="rounded bg-muted px-1 py-0.5">
              {account.externalAccountId}
            </code>
          </div>
        )}
        {account?.connectedAt && (
          <div className="text-xs text-muted-foreground">
            Connected {new Date(account.connectedAt).toLocaleDateString()}
          </div>
        )}
        {hasError && account.lastError && (
          <div className="flex items-start gap-1.5 text-xs text-red-700">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <span>{account.lastError}</span>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex-wrap gap-2">
        {!isConnected && !isDisabled && (
          <ConnectAction info={info} />
        )}
        {isDisabled && <ConnectAction info={info} label="Reconnect" />}
        {isConnected && !isActive && <SetActiveButton provider={info.name} />}
        {isConnected && <DisconnectButton provider={info.name} displayName={info.displayName} />}
      </CardFooter>
    </Card>
  );
}

function StatusBadge({ account }: { account: PaymentAccount | null }) {
  if (!account || account.status === 'pending') {
    return <Badge variant="outline" className="text-xs">Not connected</Badge>;
  }
  if (account.status === 'error') {
    return <Badge variant="destructive" className="text-xs">Error</Badge>;
  }
  if (account.status === 'disabled') {
    return <Badge variant="secondary" className="text-xs">Disabled</Badge>;
  }
  if (account.isActive) {
    return (
      <Badge className="bg-green-600 text-xs hover:bg-green-700">
        <CheckCircle2 className="mr-1 h-3 w-3" />
        Active
      </Badge>
    );
  }
  return <Badge variant="secondary" className="text-xs">Connected</Badge>;
}

// ─── Connect action: dispatches to the right flow ────────────────────

function ConnectAction({ info, label = 'Connect' }: { info: ProviderInfo; label?: string }) {
  if (info.connectMode === 'oauth') {
    return <StripeConnectButton label={label} />;
  }
  if (info.name === 'n_genius') {
    return <NGeniusConnectDialog label={label} />;
  }
  return <ZiinaConnectDialog label={label} />;
}

// True only when the platform has Stripe Connect OAuth configured. Baked in at
// build time via `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`. Until a UAE trade license
// lets the founder activate Stripe Connect, this stays unset and the Stripe
// card shows a disabled "Coming soon" state instead of a red error toast.
const STRIPE_ENABLED = Boolean(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);

function StripeConnectButton({ label }: { label: string }) {
  const connect = useConnectStripe();

  if (!STRIPE_ENABLED) {
    return (
      <Button size="sm" variant="outline" disabled title="Stripe Connect is not available on this platform yet.">
        <Link2 className="mr-2 h-4 w-4" />
        Coming soon
      </Button>
    );
  }

  async function handleClick() {
    try {
      const res = await connect.mutateAsync();
      if (res.success) {
        window.location.href = res.data.redirectUrl;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start Stripe connection');
    }
  }

  return (
    <Button onClick={handleClick} disabled={connect.isPending} size="sm">
      {connect.isPending ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Redirecting…
        </>
      ) : (
        <>
          <Link2 className="mr-2 h-4 w-4" />
          {label} Stripe
        </>
      )}
    </Button>
  );
}

// ─── N-Genius credential dialog ───────────────────────────────────────

const nGeniusSchema = z.object({
  apiKey: z.string().min(1, 'Service account API key is required'),
  outletReference: z.string().min(1, 'Outlet reference is required'),
  realmName: z.string().optional(),
  webhookHeaderName: z.string().optional(),
  webhookHeaderValue: z.string().optional(),
});
type NGeniusForm = z.infer<typeof nGeniusSchema>;

function NGeniusConnectDialog({ label }: { label: string }) {
  const [open, setOpen] = useState(false);
  const connect = useConnectNGenius();

  const form = useForm<NGeniusForm>({
    resolver: zodResolver(nGeniusSchema),
    defaultValues: {
      apiKey: '',
      outletReference: '',
      realmName: '',
      webhookHeaderName: '',
      webhookHeaderValue: '',
    },
  });

  async function onSubmit(values: NGeniusForm) {
    try {
      await connect.mutateAsync({
        apiKey: values.apiKey,
        outletReference: values.outletReference,
        realmName: values.realmName || undefined,
        webhookHeaderName: values.webhookHeaderName || undefined,
        webhookHeaderValue: values.webhookHeaderValue || undefined,
        makeActive: true,
      });
      toast.success('N-Genius connected');
      form.reset();
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Connection failed');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Link2 className="mr-2 h-4 w-4" />
          {label} N-Genius
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect N-Genius</DialogTitle>
          <DialogDescription>
            Paste your Service Account API key and Outlet Reference from the N-Genius merchant
            portal (Settings &rarr; Integration &rarr; Service Accounts).
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="apiKey"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Service Account API Key</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="Paste the API key" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="outletReference"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Outlet Reference</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. 12345678-abcd-..." {...field} />
                  </FormControl>
                  <FormDescription className="text-xs">
                    Found under Settings &rarr; Organizational Hierarchy.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="realmName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Realm Name (optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="Tenant realm, if your outlet requires one" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="rounded-md bg-muted/50 p-3 space-y-3">
              <p className="text-xs font-medium">Webhook (optional)</p>
              <p className="text-xs text-muted-foreground">
                If you set a custom header on your webhook in the N-Genius portal, copy the
                name and value here so incoming webhooks can be verified.
              </p>
              <FormField
                control={form.control}
                name="webhookHeaderName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Header Name</FormLabel>
                    <FormControl>
                      <Input placeholder="X-Webhook-Token" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="webhookHeaderValue"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Header Value</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="Shared secret" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={connect.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={connect.isPending}>
                {connect.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Validating…
                  </>
                ) : (
                  'Connect'
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Ziina credential dialog ──────────────────────────────────────────

const ziinaSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  webhookSigningSecret: z.string().optional(),
});
type ZiinaForm = z.infer<typeof ziinaSchema>;

function ZiinaConnectDialog({ label }: { label: string }) {
  const [open, setOpen] = useState(false);
  const connect = useConnectZiina();

  const form = useForm<ZiinaForm>({
    resolver: zodResolver(ziinaSchema),
    defaultValues: { apiKey: '', webhookSigningSecret: '' },
  });

  async function onSubmit(values: ZiinaForm) {
    try {
      await connect.mutateAsync({
        apiKey: values.apiKey,
        webhookSigningSecret: values.webhookSigningSecret || undefined,
        makeActive: true,
      });
      toast.success('Ziina connected');
      form.reset();
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Connection failed');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Link2 className="mr-2 h-4 w-4" />
          {label} Ziina
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect Ziina</DialogTitle>
          <DialogDescription>
            Paste the API key from your Ziina business dashboard. If you&apos;ve configured a
            webhook, include its signing secret so we can verify incoming events.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="apiKey"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>API Key</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="Paste the API key" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="webhookSigningSecret"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Webhook Signing Secret (optional)</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="From the webhook config" {...field} />
                  </FormControl>
                  <FormDescription className="text-xs">
                    Used to verify the `X-Hmac-Signature` header on incoming webhooks.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={connect.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={connect.isPending}>
                {connect.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Validating…
                  </>
                ) : (
                  'Connect'
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Active-provider switch + disconnect ─────────────────────────────

function SetActiveButton({ provider }: { provider: PaymentProviderName }) {
  const setActive = useSetActiveProvider();

  async function handleClick() {
    try {
      await setActive.mutateAsync(provider);
      toast.success('Active provider updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change active provider');
    }
  }

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={handleClick}
      disabled={setActive.isPending}
    >
      Set active
    </Button>
  );
}

function DisconnectButton({
  provider,
  displayName,
}: {
  provider: PaymentProviderName;
  displayName: string;
}) {
  const disconnect = useDisconnectProvider();

  async function handleConfirm() {
    try {
      await disconnect.mutateAsync(provider);
      toast.success(`${displayName} disconnected`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not disconnect');
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <Unlink className="mr-2 h-4 w-4" />
          Disconnect
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Disconnect {displayName}?</AlertDialogTitle>
          <AlertDialogDescription>
            New bookings will fall back to the next configured provider. In-flight payments on{' '}
            {displayName} still process normally.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={disconnect.isPending}>
            {disconnect.isPending ? 'Disconnecting…' : 'Disconnect'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
