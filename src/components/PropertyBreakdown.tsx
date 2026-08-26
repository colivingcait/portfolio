'use client';

import { useState } from 'react';
import Link from 'next/link';
import { formatCents } from '@/lib/engine/money';
import { shortMonth } from '@/lib/engine/metrics-catalog';
import { Sparkline } from '@/components/charts';

/**
 * Every house on one screen, as one table.
 *
 * This was a stack of expandable cards, which meant scrolling past three
 * houses to reach the fourth and never seeing them side by side — and
 * comparing houses is the only reason to look at four of them at once. A
 * table compares; a list of cards does not.
 *
 * There are more measures than fit across a screen, so they come in two sets
 * you switch between rather than thirteen columns you scroll sideways through.
 * Narrowing to a single house in the page's own Property control turns this
 * into that house's rooms, which is the drill-down that used to need a click
 * per card.
 */

export interface BreakdownRoom {
  roomNumber: string;
  byMonth: (number | null)[];
  medianCents: number | null;
  lastCents: number | null;
  people: number;
}

export interface BreakdownProperty {
  id: string;
  name: string;
  color: string;
  roomsLet: number;
  roomsTotal: number;
  occupancyRate: number | null;
  turnovers: number;
  turnoversProvisional: boolean;
  membersActive: number;
  netBilledCents: number;
  grossCollectedCents: number;
  bookingFeesCents: number;
  serviceFeesCents: number;
  feesCents: number;
  hostEarningsCents: number;
  adjustmentsCents: number;
  payoutCents: number;
  delinquencyCents: number;
  collectionRate: number | null;
  perRoomCents: number | null;
  inFlight: boolean;
  outlierReason: 'first_active_month' | 'second_month_low_occupancy' | null;
  rooms: BreakdownRoom[];
}

type ColumnSet = 'money' | 'operating';
type RoomSort = 'roomNumber' | 'people' | 'medianCents' | 'lastCents';

export function PropertyBreakdown({ properties, months }: { properties: BreakdownProperty[]; months: string[] }) {
  const [columns, setColumns] = useState<ColumnSet>('money');
  const single = properties.length === 1 ? properties[0] : null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1">
        <span className="mr-1 text-[11px] text-muted">Showing</span>
        {(
          [
            ['money', 'Money'],
            ['operating', 'Occupancy & turnover'],
          ] as [ColumnSet, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={key === columns}
            onClick={() => setColumns(key)}
            className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
              key === columns ? 'bg-surface-2 text-text' : 'text-muted hover:text-text'
            }`}
          >
            {label}
          </button>
        ))}
        {single ? (
          <span className="ml-auto text-[11px] text-muted">
            Showing {single.name}. Switch to all properties above to compare houses.
          </span>
        ) : null}
      </div>

      <div className="overflow-x-auto">
        {columns === 'money' ? <MoneyTable properties={properties} /> : <OperatingTable properties={properties} />}
      </div>

      {single ? <RoomTable property={single} months={months} /> : null}
    </div>
  );
}

function MoneyTable({ properties }: { properties: BreakdownProperty[] }) {
  const total = (pick: (p: BreakdownProperty) => number) => properties.reduce((sum, p) => sum + pick(p), 0);

  return (
    <table>
      <thead>
        <tr>
          <Th>Property</Th>
          <Th right>Billed</Th>
          <Th right>Collected</Th>
          <Th right>Booking fees</Th>
          <Th right>Service fees</Th>
          <Th right>Host earnings</Th>
          <Th right>Payout</Th>
          <Th right>Per room let</Th>
        </tr>
      </thead>
      <tbody>
        {properties.map((property) => (
          <tr key={property.id} className="hover:bg-surface-2/50">
            <Name property={property} />
            <Cash cents={property.netBilledCents} muted />
            <Cash cents={property.grossCollectedCents} />
            <Cash cents={property.bookingFeesCents} muted />
            <Cash cents={property.serviceFeesCents} muted />
            <Cash cents={property.hostEarningsCents} />
            <Cash cents={property.payoutCents} />
            <Cash cents={property.perRoomCents ?? 0} muted />
          </tr>
        ))}
        <tr className="border-t border-line">
          <td className="px-2 py-2 text-[12px]"><strong>Total</strong></td>
          <Cash cents={total((p) => p.netBilledCents)} muted strong />
          <Cash cents={total((p) => p.grossCollectedCents)} strong />
          <Cash cents={total((p) => p.bookingFeesCents)} muted strong />
          <Cash cents={total((p) => p.serviceFeesCents)} muted strong />
          <Cash cents={total((p) => p.hostEarningsCents)} strong />
          <Cash cents={total((p) => p.payoutCents)} strong />
          <td />
        </tr>
      </tbody>
    </table>
  );
}

function OperatingTable({ properties }: { properties: BreakdownProperty[] }) {
  const roomsLet = properties.reduce((sum, p) => sum + p.roomsLet, 0);
  const roomsTotal = properties.reduce((sum, p) => sum + p.roomsTotal, 0);
  const turnovers = properties.reduce((sum, p) => sum + p.turnovers, 0);
  const provisional = properties.some((p) => p.turnoversProvisional);

  return (
    <table>
      <thead>
        <tr>
          <Th>Property</Th>
          <Th right>Rooms let</Th>
          <Th right>Occupancy</Th>
          <Th right>Turnovers</Th>
          <Th right>Residents</Th>
          <Th right>Collection</Th>
          <Th right>Lost rent</Th>
          <Th right>Fees kept</Th>
        </tr>
      </thead>
      <tbody>
        {properties.map((property) => (
          <tr key={property.id} className="hover:bg-surface-2/50">
            <Name property={property} />
            <td className="px-2 py-2 text-right">
              <span className="num text-[12px]">
                {property.roomsLet}/{property.roomsTotal}
              </span>
            </td>
            <td className="px-2 py-2 text-right">
              <span className="num text-[12px]">
                {property.occupancyRate === null ? '—' : `${property.occupancyRate.toFixed(0)}%`}
              </span>
            </td>
            <td className="px-2 py-2 text-right">
              <span className={`num text-[12px] ${property.turnovers > 2 ? 'text-bad' : ''}`}>
                {property.turnovers}
                {property.turnoversProvisional ? '+' : ''}
              </span>
            </td>
            <td className="px-2 py-2 text-right">
              <span className="num text-[12px] text-muted">{property.membersActive}</span>
            </td>
            <td className="px-2 py-2 text-right">
              <span className="num text-[12px]">
                {property.inFlight || property.collectionRate === null ? '—' : `${property.collectionRate.toFixed(0)}%`}
              </span>
            </td>
            <td className="px-2 py-2 text-right">
              {property.inFlight ? (
                <span className="num text-[12px] text-muted">—</span>
              ) : property.delinquencyCents > 0 ? (
                <span className="num text-[12px] text-bad">{formatCents(property.delinquencyCents)}</span>
              ) : (
                <span className="num text-[12px] text-muted">all collected</span>
              )}
            </td>
            <td className="px-2 py-2 text-right">
              <span className="num text-[12px] text-muted">
                {property.grossCollectedCents > 0
                  ? `${((-property.feesCents / property.grossCollectedCents) * 100).toFixed(0)}%`
                  : '—'}
              </span>
            </td>
          </tr>
        ))}
        <tr className="border-t border-line">
          <td className="px-2 py-2 text-[12px]"><strong>Total</strong></td>
          <td className="px-2 py-2 text-right">
            <strong className="num text-[12px]">{roomsLet}/{roomsTotal}</strong>
          </td>
          <td />
          <td className="px-2 py-2 text-right">
            <strong className="num text-[12px]">{turnovers}{provisional ? '+' : ''}</strong>
          </td>
          <td colSpan={4} />
        </tr>
      </tbody>
    </table>
  );
}

/** The house, with the ramp caveat where one applies. */
function Name({ property }: { property: BreakdownProperty }) {
  return (
    <td className="px-2 py-2">
      <span className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 shrink-0 rounded-[2px]" style={{ background: property.color }} />
        <Link href={`/properties/${property.id}`} className="text-[12px] hover:text-accent">
          {property.name}
        </Link>
        {property.outlierReason ? (
          <span
            className="text-[10px] text-warn"
            title={
              property.outlierReason === 'first_active_month'
                ? 'First month on the platform — left out of the stabilized room rate.'
                : 'Second month and under 70% full — still ramping.'
            }
          >
            {property.outlierReason === 'first_active_month' ? 'first month' : 'ramping'}
          </span>
        ) : null}
      </span>
    </td>
  );
}

function Th({ children, right = false }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted ${
        right ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  );
}

function Cash({ cents, muted = false, strong = false }: { cents: number; muted?: boolean; strong?: boolean }) {
  const body = formatCents(cents);
  return (
    <td className="px-2 py-2 text-right">
      <span className={`num text-[12px] ${muted ? 'text-muted' : ''}`}>{strong ? <strong>{body}</strong> : body}</span>
    </td>
  );
}

/** One house's rooms, once a house has been picked. */
function RoomTable({ property, months }: { property: BreakdownProperty; months: string[] }) {
  const [sort, setSort] = useState<RoomSort>('medianCents');
  const [ascending, setAscending] = useState(false);

  const rooms = [...property.rooms].sort((a, b) => {
    const direction = ascending ? 1 : -1;
    if (sort === 'roomNumber') return a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }) * direction;
    return ((a[sort] ?? -1) - (b[sort] ?? -1)) * direction;
  });
  const best = Math.max(0, ...property.rooms.map((room) => room.medianCents ?? 0));

  const sortBy = (key: RoomSort) => {
    if (key === sort) setAscending((current) => !current);
    else {
      setSort(key);
      setAscending(key === 'roomNumber');
    }
  };

  if (property.rooms.length === 0) {
    return <p className="mt-4 text-[12px] text-muted">No room-level lines imported for this house.</p>;
  }

  const header = (label: string, key: RoomSort, right = false) => (
    <th className={`px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide ${right ? 'text-right' : 'text-left'}`}>
      <button
        type="button"
        onClick={() => sortBy(key)}
        className={`hover:text-text ${sort === key ? 'text-text' : 'text-muted'}`}
      >
        {label}
        {sort === key ? <span className="ml-1">{ascending ? '↑' : '↓'}</span> : null}
      </button>
    </th>
  );

  return (
    <div className="mt-5 border-t border-line pt-4">
      <p className="mb-2 text-[11px] leading-relaxed text-muted">
        {property.name} room by room. The comparison that matters is between rooms under the same roof — they differ
        by hundreds a month, and the ones that turn over most earn least.
      </p>
      <div className="max-w-2xl overflow-x-auto">
        <table>
          <thead>
            <tr>
              {header('Room', 'roomNumber')}
              {header('People', 'people', true)}
              <th className="px-2 py-1.5 text-left text-[11px] font-medium uppercase tracking-wide text-muted">
                Earnings by month
              </th>
              {header('Median', 'medianCents', true)}
              {header('Latest', 'lastCents', true)}
            </tr>
          </thead>
          <tbody>
            {rooms.map((room) => (
              <tr key={room.roomNumber} className="hover:bg-surface-2/50">
                <td className="px-2 py-1.5 text-[12px]">
                  Room {room.roomNumber}
                  {room.people === 0 && room.medianCents === null ? (
                    <span
                      className="ml-2 text-[10px] text-bad"
                      title="No dues have ever stuck to this room — either none were billed, or every booking was reversed."
                    >
                      never let
                    </span>
                  ) : null}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <span
                    className={`num text-[12px] ${room.people >= 4 ? 'text-bad' : room.people >= 3 ? 'text-warn' : 'text-muted'}`}
                    title={`${room.people} ${room.people === 1 ? 'person' : 'different people'} across ${months.length} months`}
                  >
                    {room.people}
                  </span>
                </td>
                <td className="px-2 py-1">
                  <Sparkline
                    points={room.byMonth.map((value, i) => ({ label: shortMonth(months[i] ?? ''), value }))}
                    color={property.color}
                    width={150}
                    height={26}
                    format={(v) => formatCents(v)}
                  />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <span className="num text-[12px]">{room.medianCents === null ? '—' : formatCents(room.medianCents)}</span>
                  {room.medianCents !== null && best > 0 && room.medianCents < best * 0.7 ? (
                    <span className="ml-1.5 text-[10px] text-warn">{formatCents(best - room.medianCents)} under</span>
                  ) : null}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <span className="num text-[12px] text-muted">
                    {room.lastCents === null ? '—' : formatCents(room.lastCents)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
