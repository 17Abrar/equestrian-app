/**
 * Audit F-4 (2026-05-08 r6 PR Alpha-2): barrel for the consolidated per-route
 * response DTOs. Web + mobile hooks now import from here instead of
 * re-declaring the wire shape locally.
 *
 * Importers can either pull from this barrel or directly from a specific
 * file. The hooks files re-export the same shapes for backwards
 * compatibility with existing component-level imports
 * (`import { type Booking } from '@/hooks/use-bookings'`).
 */

export * from './bookings';
export * from './competitions';
export * from './dashboard';
export * from './finances';
export * from './horse-health';
export * from './horses';
export * from './payment-accounts';
export * from './reports';
export * from './riders';
export * from './settings';
export * from './staff';
export * from './subscription';
