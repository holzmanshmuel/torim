/**
 * Tenant isolation for the admin routes, proven against a real Postgres.
 *
 * Every /admin page and Server Action reaches the database through `src/app/admin/data.ts`
 * (or the tenant-scoped helpers in `src/lib`), always after a guard that has entered the
 * tenant. This file takes that layer and points it at another business's ids on purpose.
 *
 * Reads must come back empty and writes must come back `false` — not throw, not
 * silently succeed. A write that "succeeded" against zero rows is the shape of bug that
 * looks fine in a UI and is a cross-tenant breach in the database, so every mutation
 * here is asserted twice: the call reports a miss, AND the victim's row is re-read from
 * its own tenant and found unchanged.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addClosure,
  addDateOverride,
  addWorkingHours,
  confirmBooking,
  countServiceBookings,
  createService,
  deleteClosure,
  deleteDateOverride,
  deleteService,
  deleteWorkingHours,
  getAdminService,
  getMessagingSettings,
  listAdminServices,
  listClosures,
  listCustomerVisits,
  listDateOverrides,
  listWorkingHours,
  moveService,
  setBookingNote,
  setServiceActive,
  updateBusinessSettings,
  updateService,
  type ServiceInput,
} from './data';
import { getBookingForAdmin, listBookingsForDay, markBookingSeen } from '@/lib/admin-bookings';
import { createBooking } from '@/lib/booking';
import { findBusinessById } from '@/lib/businesses';
import { findOrCreateCustomer, getCustomer, searchCustomers } from '@/lib/customers';
import { systemQueryOne } from '@/lib/db';
import { runWithTenant } from '@/lib/tenant';
import { localToInstant } from '@/lib/time';
import { startTestTransaction, type TestDatabase } from '@/lib/test-db';

const TZ = 'Asia/Jerusalem';
const MONDAY = '2026-06-15';

type Fixture = {
  businessId: string;
  serviceId: string;
  customerId: string;
  bookingId: string;
  hoursId: string;
  closureId: string;
  overrideId: string;
};

let db: TestDatabase;
let alpha: Fixture;
let beta: Fixture;

const serviceInput = (name: string): ServiceInput => ({
  name,
  nameHe: null,
  description: null,
  durationMin: 60,
  priceMinor: 12000,
  bufferBeforeMin: 0,
  bufferAfterMin: 0,
  colour: 'blue',
  active: true,
});

async function makeFixture(slug: string, name: string, minutes: number): Promise<Fixture> {
  const business = await systemQueryOne<{ id: string }>(
    `INSERT INTO torim.businesses (slug, name, timezone, currency, default_calling_code)
     VALUES ($1, $2, $3, 'ILS', '972') RETURNING id`,
    [slug, name, TZ],
  );
  const businessId = business!.id;

  return runWithTenant(businessId, async () => {
    const service = await createService(serviceInput(`${name} service`));
    const customer = await findOrCreateCustomer({
      name: `${name} customer`,
      phone: `05${minutes}1112222`.slice(0, 10),
      callingCode: '972',
    });
    const booking = await createBooking({
      businessId,
      customerId: customer.id,
      serviceId: service.id,
      startsAt: localToInstant(MONDAY, minutes, TZ),
      source: 'customer',
    });
    const hours = await addWorkingHours(1, 540, 1020);
    const closureId = await addClosure({
      onDate: '2026-07-01',
      startMin: null,
      endMin: null,
      label: `${name} holiday`,
    });
    const overrideId = await addDateOverride({
      onDate: '2026-07-02',
      startMin: 600,
      endMin: 720,
      label: `${name} short day`,
    });

    return {
      businessId,
      serviceId: service.id,
      customerId: customer.id,
      bookingId: booking.id,
      hoursId: hours.id,
      closureId,
      overrideId,
    };
  });
}

beforeAll(async () => {
  db = await startTestTransaction();
  alpha = await makeFixture('scope-alpha', 'Alpha', 600);
  beta = await makeFixture('scope-beta', 'Beta', 660);
});

afterAll(async () => {
  await db.rollback();
});

/** Everything below runs as Alpha, aimed at Beta. */
const asAlpha = <T>(fn: () => Promise<T>): Promise<T> => runWithTenant(alpha.businessId, fn);
const asBeta = <T>(fn: () => Promise<T>): Promise<T> => runWithTenant(beta.businessId, fn);

describe('admin reads are tenant-scoped', () => {
  it('lists only this business’s services', async () => {
    const services = await asAlpha(listAdminServices);
    expect(services.map((s) => s.name)).toEqual(['Alpha service']);
    expect(await asAlpha(() => getAdminService(beta.serviceId))).toBeNull();
  });

  it('lists only this business’s hours, closures and one-off hours', async () => {
    const [hours, closures, overrides] = await asAlpha(async () => [
      await listWorkingHours(),
      await listClosures('2026-01-01'),
      await listDateOverrides('2026-01-01'),
    ]);
    expect(hours).toHaveLength(1);
    expect(hours[0]!.id).toBe(alpha.hoursId);
    expect(closures.map((c) => c.label)).toEqual(['Alpha holiday']);
    expect(overrides.map((o) => o.label)).toEqual(['Alpha short day']);
  });

  it('shows only this business’s day', async () => {
    const day = await asAlpha(() =>
      listBookingsForDay({ businessId: alpha.businessId, date: MONDAY }),
    );
    expect(day).toHaveLength(1);
    expect(day[0]!.id).toBe(alpha.bookingId);
    expect(await asAlpha(() => getBookingForAdmin(beta.bookingId))).toBeNull();
  });

  it('cannot find another business’s customer, by id or by search', async () => {
    expect(await asAlpha(() => getCustomer(beta.customerId))).toBeNull();
    expect(await asAlpha(() => searchCustomers('Beta'))).toEqual([]);
    expect(await asAlpha(() => listCustomerVisits(beta.customerId))).toEqual([]);
  });

  it('counts no bookings for another business’s service', async () => {
    expect(await asAlpha(() => countServiceBookings(beta.serviceId))).toBe(0);
    expect(await asBeta(() => countServiceBookings(beta.serviceId))).toBe(1);
  });
});

describe('admin writes cannot reach another business', () => {
  it('refuses to edit, retire, reorder or delete another business’s service', async () => {
    await asAlpha(async () => {
      expect(await updateService(beta.serviceId, serviceInput('hijacked'))).toBe(false);
      expect(await setServiceActive(beta.serviceId, false)).toBe(false);
      expect(await moveService(beta.serviceId, 1)).toBe(false);
      expect(await deleteService(beta.serviceId)).toBe(false);
    });

    const survivor = await asBeta(() => getAdminService(beta.serviceId));
    expect(survivor).not.toBeNull();
    expect(survivor!.name).toBe('Beta service');
    expect(survivor!.active).toBe(true);
  });

  it('refuses to delete another business’s hours, closure or one-off hours', async () => {
    await asAlpha(async () => {
      expect(await deleteWorkingHours(beta.hoursId)).toBe(false);
      expect(await deleteClosure(beta.closureId)).toBe(false);
      expect(await deleteDateOverride(beta.overrideId)).toBe(false);
    });

    await asBeta(async () => {
      expect(await listWorkingHours()).toHaveLength(1);
      expect(await listClosures('2026-01-01')).toHaveLength(1);
      expect(await listDateOverrides('2026-01-01')).toHaveLength(1);
    });
  });

  it('refuses to note, confirm or acknowledge another business’s booking', async () => {
    await asAlpha(async () => {
      expect(await setBookingNote(beta.bookingId, 'not yours')).toBe(false);
      expect(await confirmBooking(beta.bookingId)).toBe(false);
      // markBookingSeen has no return value, so the proof is on the far side.
      await markBookingSeen(beta.bookingId);
    });

    const booking = await asBeta(() => getBookingForAdmin(beta.bookingId));
    expect(booking!.note).toBeNull();
    // The customer-made booking is still flagged: Alpha's acknowledgement did nothing.
    expect(booking!.needsAttention).toBe(true);
  });

  /**
   * torim.businesses is deliberately outside RLS, so this is the one admin write with
   * no policy underneath it. `updateBusinessSettings` takes no business id at all — it
   * reads the tenant the guard established — which is what makes that safe.
   */
  it('writes settings only to the business in scope', async () => {
    await asAlpha(() =>
      updateBusinessSettings({
        name: 'Alpha renamed',
        nameHe: null,
        slug: 'scope-alpha',
        timezone: TZ,
        currency: 'ILS',
        defaultLocale: 'he',
        defaultCallingCode: '972',
        ownerWhatsappPhone: null,
        slotGranularityMin: 30,
        minNoticeMin: 60,
        maxAdvanceDays: 30,
        cancellationWindowMin: 120,
        confirmNewCustomers: true,
        reminderLeadMin: 1440,
        askCustomerEmail: true,
      }),
    );

    const alphaBusiness = await findBusinessById(alpha.businessId);
    const betaBusiness = await findBusinessById(beta.businessId);
    expect(alphaBusiness!.name).toBe('Alpha renamed');
    expect(alphaBusiness!.slotGranularityMin).toBe(30);
    expect(betaBusiness!.name).toBe('Beta');
    expect(betaBusiness!.slotGranularityMin).toBe(15);

    // The messaging columns are on the same row and get the same treatment: written for
    // the tenant in scope, and left at their defaults for everyone else.
    expect(await asAlpha(getMessagingSettings)).toEqual({
      askCustomerEmail: true,
      reminderLeadMin: 1440,
    });
    expect(await asBeta(getMessagingSettings)).toEqual({
      askCustomerEmail: false,
      reminderLeadMin: null,
    });
  });

  /**
   * NULL and 0 are different answers, and the round trip has to preserve the difference.
   *
   * NULL means this business wants no reminders at all; 0 means "at the appointment
   * time". `scheduleForBooking` branches on exactly this, so a layer that collapsed one
   * into the other would either silently stop reminding a business that asked to be
   * reminded, or start reminding one that asked not to be.
   */
  it('keeps "no reminders" (null) distinct from "0 minutes before"', async () => {
    const settings = {
      name: 'Beta',
      nameHe: null,
      slug: 'scope-beta',
      timezone: TZ,
      currency: 'ILS',
      defaultLocale: 'he' as const,
      defaultCallingCode: '972',
      ownerWhatsappPhone: null,
      slotGranularityMin: 15,
      minNoticeMin: 60,
      maxAdvanceDays: 30,
      cancellationWindowMin: 120,
      confirmNewCustomers: false,
      reminderLeadMin: null as number | null,
      askCustomerEmail: false,
    };

    await asBeta(() => updateBusinessSettings({ ...settings, reminderLeadMin: 0 }));
    expect((await asBeta(getMessagingSettings)).reminderLeadMin).toBe(0);

    await asBeta(() => updateBusinessSettings({ ...settings, reminderLeadMin: null }));
    expect((await asBeta(getMessagingSettings)).reminderLeadMin).toBeNull();
  });
});
