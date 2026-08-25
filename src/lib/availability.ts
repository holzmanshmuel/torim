/**
 * Loads what the slot engine needs and hands it over.
 *
 * The engine in slots.ts is pure on purpose — every rule it applies is tested without a
 * database. This module's only job is to fetch the right rows, tenant-scoped, and shape
 * them. Keep the rules there, not here.
 */
import { findBusinessById } from './businesses';
import { query } from './db';
import {
  generateAvailability,
  type BusyInterval,
  type Closure,
  type DateOverride,
  type DayAvailability,
  type WorkingHour,
} from './slots';
import type { DateKey } from './time';

export type ServiceSummary = {
  id: string;
  name: string;
  nameHe: string | null;
  description: string | null;
  durationMin: number;
  priceMinor: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  colour: string;
  active: boolean;
};

type ServiceRow = {
  id: string;
  name: string;
  name_he: string | null;
  description: string | null;
  duration_min: number;
  price_minor: number;
  buffer_before_min: number;
  buffer_after_min: number;
  colour: string;
  active: boolean;
};

const SERVICE_COLUMNS = `id, name, name_he, description, duration_min, price_minor,
                         buffer_before_min, buffer_after_min, colour, active`;

function toService(row: ServiceRow): ServiceSummary {
  return {
    id: row.id,
    name: row.name,
    nameHe: row.name_he,
    description: row.description,
    durationMin: row.duration_min,
    priceMinor: row.price_minor,
    bufferBeforeMin: row.buffer_before_min,
    bufferAfterMin: row.buffer_after_min,
    colour: row.colour,
    active: row.active,
  };
}

/** Bookable services only, in the order the owner arranged them. */
export async function listActiveServices(): Promise<ServiceSummary[]> {
  const rows = await query<ServiceRow>(
    `SELECT ${SERVICE_COLUMNS} FROM torim.services
      WHERE active ORDER BY sort_order, name`,
  );
  return rows.map(toService);
}

/** Every service including retired ones — the admin catalogue view. */
export async function listAllServices(): Promise<ServiceSummary[]> {
  const rows = await query<ServiceRow>(
    `SELECT ${SERVICE_COLUMNS} FROM torim.services ORDER BY sort_order, name`,
  );
  return rows.map(toService);
}

/** RLS makes this null for another business's service, which is the point. */
export async function getService(serviceId: string): Promise<ServiceSummary | null> {
  const rows = await query<ServiceRow>(
    `SELECT ${SERVICE_COLUMNS} FROM torim.services WHERE id = $1`,
    [serviceId],
  );
  return rows[0] ? toService(rows[0]) : null;
}

export type AvailabilityRequest = {
  businessId: string;
  serviceId: string;
  from: DateKey;
  to: DateKey;
  now?: Date;
  /**
   * A booking to ignore when working out what is busy. Used when rescheduling: without
   * it, a booking blocks its own move and a customer can never shift by one slot.
   */
  excludeBookingId?: string;
};

export async function getAvailability(request: AvailabilityRequest): Promise<DayAvailability[]> {
  const { businessId, serviceId, from, to } = request;
  const now = request.now ?? new Date();

  const business = await findBusinessById(businessId);
  if (!business) throw new Error(`Unknown business: ${businessId}`);

  const service = await getService(serviceId);
  if (!service) throw new Error(`Unknown service for this business: ${serviceId}`);

  const hourRows = await query<{ weekday: number; start_min: number; end_min: number }>(
    'SELECT weekday, start_min, end_min FROM torim.working_hours',
  );
  const workingHours: WorkingHour[] = hourRows.map((r) => ({
    weekday: r.weekday,
    startMin: r.start_min,
    endMin: r.end_min,
  }));

  // to_char, not the driver's date parsing: a DATE is a timezone-free day key and must
  // stay a string. Letting it become a Date reintroduces exactly the timezone slippage
  // the day-key convention exists to avoid.
  const closureRows = await query<{ on_date: string; start_min: number | null; end_min: number | null }>(
    `SELECT to_char(on_date, 'YYYY-MM-DD') AS on_date, start_min, end_min
       FROM torim.closures WHERE on_date BETWEEN $1::date AND $2::date`,
    [from, to],
  );
  const closures: Closure[] = closureRows.map((r) => ({
    onDate: r.on_date,
    startMin: r.start_min,
    endMin: r.end_min,
  }));

  const overrideRows = await query<{ on_date: string; start_min: number; end_min: number }>(
    `SELECT to_char(on_date, 'YYYY-MM-DD') AS on_date, start_min, end_min
       FROM torim.date_overrides WHERE on_date BETWEEN $1::date AND $2::date`,
    [from, to],
  );
  const dateOverrides: DateOverride[] = overrideRows.map((r) => ({
    onDate: r.on_date,
    startMin: r.start_min,
    endMin: r.end_min,
  }));

  // Cancelled and no-show bookings free their slot; only live ones occupy time.
  // The window is widened by a day at each end so a booking that starts just outside
  // the range but whose buffer reaches into it is still counted.
  const busyRows = await query<{ blocks_from: Date; blocks_until: Date }>(
    `SELECT blocks_from, blocks_until FROM torim.bookings
      WHERE status IN ('pending', 'confirmed')
        AND blocks_until > ($1::date - INTERVAL '1 day')
        AND blocks_from  < ($2::date + INTERVAL '2 days')
        AND ($3::uuid IS NULL OR id <> $3::uuid)`,
    [from, to, request.excludeBookingId ?? null],
  );
  const busy: BusyInterval[] = busyRows.map((r) => ({ from: r.blocks_from, until: r.blocks_until }));

  return generateAvailability({
    from,
    to,
    now,
    policy: {
      timezone: business.timezone,
      slotGranularityMin: business.slotGranularityMin,
      minNoticeMin: business.minNoticeMin,
      maxAdvanceDays: business.maxAdvanceDays,
    },
    service: {
      durationMin: service.durationMin,
      bufferBeforeMin: service.bufferBeforeMin,
      bufferAfterMin: service.bufferAfterMin,
    },
    workingHours,
    closures,
    dateOverrides,
    busy,
  });
}
