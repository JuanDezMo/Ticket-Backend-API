export const TICKET_STATUSES = {
  ISSUED: 'ISSUED',
  CANCELLED_BY_EVENT: 'CANCELLED_BY_EVENT',
} as const;

export type TicketStatus = (typeof TICKET_STATUSES)[keyof typeof TICKET_STATUSES];

export interface NewTicket {
  reservationId: string;
  paymentId: string;
  userId: string;
  eventId: string;
  seatId: string;
  amount: number;
}

/** Ticket con los datos que necesita la respuesta de la compra. */
export interface Ticket extends NewTicket {
  id: string;
  status: TicketStatus;
  issuedAt: Date;
  seat: string; // etiqueta, por ejemplo C7
  transactionId: string;
}

export interface PublicTicket {
  id: string;
  reservationId: string;
  eventId: string;
  seat: string;
  status: TicketStatus;
  amount: number;
  transactionId: string;
  issuedAt: string;
}

export interface TicketListItem {
  id: string;
  status: TicketStatus;
  seat: string;
  amount: number;
  issuedAt: string;
  event: { id: string; name: string; venue: string; startDate: string };
}
