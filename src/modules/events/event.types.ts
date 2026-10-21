export const EVENT_TYPES = {
  CONCERT: 'CONCERT',
  MEETUP: 'MEETUP',
  MEETING: 'MEETING',
  OTHER: 'OTHER',
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];
export const EVENT_TYPE_VALUES = Object.values(EVENT_TYPES) as [EventType, ...EventType[]];

export const EVENT_STATUSES = { ACTIVE: 'ACTIVE', CANCELLED: 'CANCELLED' } as const;

export type EventStatus = (typeof EVENT_STATUSES)[keyof typeof EVENT_STATUSES];
export const EVENT_STATUS_VALUES = Object.values(EVENT_STATUSES) as [EventStatus, ...EventStatus[]];

// numeric(12,2): hasta 9.999.999.999,99
export const MAX_PRICE = 9_999_999_999.99;

export interface NewEvent {
  name: string;
  description: string;
  type: EventType;
  venue: string;
  price: number;
  capacity: number;
  startDate: Date;
  endDate: Date;
}

export interface Event extends NewEvent {
  id: string;
  status: EventStatus;
  createdAt: Date;
}

/** Vista pública: fechas ISO 8601 y el precio como número. */
export interface PublicEvent {
  id: string;
  name: string;
  description: string;
  type: EventType;
  venue: string;
  price: number;
  capacity: number;
  startDate: string;
  endDate: string;
  createdAt: string;
  status: EventStatus;
}

export interface EventFilters {
  status?: EventStatus;
  type?: EventType;
  startFrom?: Date;
  startTo?: Date;
  search?: string;
}
