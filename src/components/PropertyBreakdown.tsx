'use client';

import { useState } from 'react';
import Link from 'next/link';
import { formatCents } from '@/lib/engine/money';
import { shortMonth } from '@/lib/engine/metrics-catalog';
import { Sparkline } from '@/components/charts';

/**
 * One house at a time, opened when you want it.
 *
 * The collapsed row carries the three figures you scan for — what came in, what
 * you kept, how full the house was. Everything else is a click away rather than
 * spread across a thirteen-column table you have to scroll sideways to read.
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
  roomsOccupied: number;
  roomsTotal: number;
  occupancyRate: number | null;
  turnovers: number;
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

type SortKey = 'roomNumber' | 'people' | 'medianCents' | 'lastCents';

export function PropertyBreakdown({ properties, months }: { properties: BreakdownProperty[]; months: string[] }) {
  const [open, setOpen] = useState<string | null>(properties.length === 1 ? properties[0].id : null);

  return (
    <div className="divide-y divide-line">
      {properties.map((property) => (
        <PropertyCard
          key={property.id}
          property={property}
          months={months}
          open={open === property.id}
          onToggle={() => setOpen(open === property.id ? null : property.id)}
        />
      ))}
    </div>
  );
}

function PropertyCard({
  property,
  months,
  open,
  onToggle,
}: {
  property: BreakdownProperty;
  months: string[];
  open: boolean;
  onToggle: () => void;
}) {
  const [sort, setSort] = useState<SortKey>('medianCents');
  const [ascending, setAscending] = useState(false);

  const rooms = [...property.rooms].sort((a, b) => {
    const direction = ascending ? 1 : -1;
    if (sort === 'roomNumber') return a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }) * direction;
    const left = a[sort] ?? -1;
    const right = b[sort] ?? -1;
    return (left - right) * direction;
  });

  const best = Math.max(0, ...property.rooms.map((room) => room.medianCents ?? 0));

  const sortBy = (key: SortKey) => {
    if (key === sort) setAscending((current) => !current);
    else {
      setSort(key);
      setAscending(key === 'roomNumber');
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-1 py-3 text-left hover:bg-surface-2/50"
      >
        <span className="text-[11px] text-muted">{open ? '▾' : '▸'}</span>
        <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: property.color }} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{property.name}</span>

        <span className="hidden gap-6 sm:flex">
          <Figure label="Collected" value={formatCents(property.grossCollectedCents)} />
          <Figure label="Host earnings" value={formatCents(property.hostEarningsCents)} />
          <Figure
            label="Occupied"
            value={
              property.occupancyRate === null
                ? '—'
                : `${property.occupancyRate.toFixed(0)}% · ${property.roomsOccupied}/${property.roomsTotal}`
            }
          />
        </span>
        <span className="num text-[13px] sm:hidden">{formatCents(property.hostEarningsCents)}</span>
      </button>

      {open ? (
        <div className="px-1 pb-5">
          <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            <Cell label="Billed" value={formatCents(property.netBilledCents)} hint="Dues raised, reversals netted out." />
            <Cell label="Collected" value={formatCents(property.grossCollectedCents)} hint="Cash the platform took in." />
            <Cell
              label="Collection rate"
              value={property.inFlight || property.collectionRate === null ? '—' : `${property.collectionRate.toFixed(0)}%`}
              hint={property.inFlight ? 'Still collecting.' : 'Cash in against billed.'}
            />
            <Cell
              label="Delinquency"
              value={property.inFlight ? '—' : property.delinquencyCents > 0 ? formatCents(property.delinquencyCents) : 'caught up'}
              tone={!property.inFlight && property.delinquencyCents > 0 ? 'bad' : 'muted'}
              hint={property.inFlight ? 'Withheld while collecting.' : 'Billed and not collected.'}
            />

            <Cell label="Booking fees" value={formatCents(property.bookingFeesCents)} hint="One per room that turned over." />
            <Cell label="Service fees" value={formatCents(property.serviceFeesCents)} hint="The platform's cut of the rent." />
            <Cell label="Host earnings" value={formatCents(property.hostEarningsCents)} hint="Collected less both fees." />
            <Cell
              label="Payout"
              value={formatCents(property.payoutCents)}
              hint={property.adjustmentsCents ? `Includes ${formatCents(property.adjustmentsCents)} of adjustments.` : 'Lands in the bank next month.'}
            />

            <Cell
              label="Occupancy"
              value={property.occupancyRate === null ? '—' : `${property.occupancyRate.toFixed(0)}%`}
              hint={`${property.roomsOccupied} of ${property.roomsTotal} rooms`}
            />
            <Cell
              label="Turnovers"
              value={String(property.turnovers)}
              tone={property.turnovers > 2 ? 'bad' : 'muted'}
              hint={`${property.membersActive} people paid across ${property.roomsOccupied} rooms.`}
            />
            <Cell
              label="Per occupied room"
              value={property.perRoomCents === null ? '—' : formatCents(property.perRoomCents)}
              hint="Host earnings over rooms filled."
            />
            <Cell
              label="Fees kept"
              value={
                property.grossCollectedCents > 0
                  ? `${((-property.feesCents / property.grossCollectedCents) * 100).toFixed(0)}%`
                  : '—'
              }
              hint="Of what was collected."
            />
          </div>

          {property.outlierReason ? (
            <p className="mb-3 text-[11px] text-warn">
              {property.outlierReason === 'first_active_month'
                ? 'First month on the platform — left out of the stabilized room rate, because a house filling up is not a house running.'
                : 'Second month and under 70% full — still ramping, so left out of the stabilized room rate.'}
            </p>
          ) : null}

          {property.rooms.length === 0 ? (
            <p className="text-[12px] text-muted">No room-level lines imported for this house.</p>
          ) : (
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <SortableTh label="Room" grow active={sort === 'roomNumber'} ascending={ascending} onClick={() => sortBy('roomNumber')} />
                    <SortableTh label="People" right active={sort === 'people'} ascending={ascending} onClick={() => sortBy('people')} />
                    <th className="px-2 py-1.5 text-left text-[11px] font-medium uppercase tracking-wide text-muted">
                      Earnings by month
                    </th>
                    <SortableTh label="Median" right active={sort === 'medianCents'} ascending={ascending} onClick={() => sortBy('medianCents')} />
                    <SortableTh label="Latest" right active={sort === 'lastCents'} ascending={ascending} onClick={() => sortBy('lastCents')} />
                  </tr>
                </thead>
                <tbody>
                  {rooms.map((room) => (
                    <tr key={room.roomNumber} className="hover:bg-surface-2/50">
                      <td className="w-full px-2 py-1.5 text-[12px]">Room {room.roomNumber}</td>
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
          )}

          <div className="mt-3">
            <Link href={`/properties/${property.id}`} className="text-[12px] text-muted underline hover:text-text">
              Everything about {property.name} →
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-right">
      <span className="block text-[10px] uppercase tracking-wide text-muted">{label}</span>
      <span className="num block text-[13px]">{value}</span>
    </span>
  );
}

function Cell({
  label,
  value,
  hint,
  tone = 'muted',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'muted' | 'bad';
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`num mt-0.5 text-[14px] ${tone === 'bad' ? 'text-bad' : ''}`}>{value}</div>
      {hint ? <div className="mt-0.5 text-[10px] leading-snug text-muted">{hint}</div> : null}
    </div>
  );
}

function SortableTh({
  label,
  right = false,
  grow = false,
  active,
  ascending,
  onClick,
}: {
  label: string;
  right?: boolean;
  /** Takes up the table's slack, so the other columns sit tight to their numbers. */
  grow?: boolean;
  active: boolean;
  ascending: boolean;
  onClick: () => void;
}) {
  return (
    <th
      className={`px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide ${right ? 'text-right' : 'text-left'} ${
        grow ? 'w-full' : ''
      }`}
    >
      <button
        type="button"
        onClick={onClick}
        aria-sort={active ? (ascending ? 'ascending' : 'descending') : 'none'}
        className={`hover:text-text ${active ? 'text-text' : 'text-muted'}`}
      >
        {label}
        {active ? <span className="ml-1">{ascending ? '↑' : '↓'}</span> : null}
      </button>
    </th>
  );
}
